require('dotenv').config()
import express, { Request, Response, NextFunction } from 'express';
import { IncomingMessage, createServer } from "http";
import mongoose from 'mongoose'
import { WebSocketServer, WebSocket } from 'ws';
import { AddressInfo } from 'net'



const iot_device = require('./iotDeviceModel')

const app = express();
const server = createServer(app);

//Mongo
mongoose.connect(process.env.DATABASE_URL)

const db = mongoose.connection
db.on('error', (error) => {
    console.log(error)
})

db.on('open', () => {
    console.log('connected to DB')
})

//initialize the WebSocket server instance
const ws_server = new WebSocketServer({ server })
//Anything to keep track of your local client connections
let activeClients = new Map<string, WebSocket>()

//Connection Events
ws_server.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    //Get username and password on connection
    let authHeader: string = request.headers.authorization.split(' ')[1]
    const [username, password] = Buffer.from(authHeader, 'base64').toString('utf-8').split(':')

    console.log(`${username} connected`)

    //{Handle your Auth}
    if (username === 'username2') {
        //How to close The connection
        ws.close(3000, 'Unauthorized')
    }

    try {
        await iot_device.findOneAndUpdate({ userName: username },
            {
                userName: username,
                queueId: process.env.REDIS_QUEUE_ID
            },
            { upsert: true });
    } catch (error) {
        console.log((error as Error).message)
    }

    //Then Assign event handlers
    activeClients.set(username, ws)
    //Give a message handler to the connection instance
    ws.on('message', async (message: string) => {
        //log the received message and send it back to the 
        console.log('received: %s from %s', message, username);
        ws.send(`Echo back -> ${message}`);
    });

    //Give Callback for disconnect
    ws.on('close', async (reasonCode: number, description: string) => {
        console.log('closed code: %s Reason: %s', reasonCode, description);
        try {
            await iot_device.findOneAndUpdate({ userName: username },
                {
                    userName: username,
                    queueId: null
                }
            );
        } catch (error) {
            console.log((error as Error).message)
        }
        activeClients.delete(username)
    });
});

const redis = require('redis');
//This publisher is used to send messages to other containers
const redis_publisher = redis.createClient();
const redis_subscriber = redis.createClient();
(async () => {
    await redis_publisher.connect();
    await redis_subscriber.connect();
    console.log('Instance Queue: %s',process.env.REDIS_QUEUE_ID)
    await redis_subscriber.subscribe(process.env.REDIS_QUEUE_ID, async (content: string) => {
        let payload = JSON.parse(content);
        console.log(payload)
        let username = payload.userName
        let message = payload.message
        var ws: WebSocket = activeClients.get(username)
        if (!ws) {
            console.log('%s was not found, cannot send message', username)
            return
        } //Do something if a username is not in client dic, in my case i just ignore it
        try {
            ws.send(message)
        }
        catch (e) {
            console.log(e)
            ws.close(1002, 'Error')
            try {
                await iot_device.findOneAndUpdate({ userName: username },
                    {
                        userName: username,
                        queueId: null
                    },
                    { upsert: true });
            } catch (error) {
                console.log((error as Error).message)
            }
            activeClients.delete(username)
        }
    });
})();

//Send  a websocket message using the username
async function submit_ws_message_to_queue(message: string, username: string) {
    const device = await iot_device.findOne({'userName': username}).exec();
    try{
        await redis_publisher.publish(device.queueId as string, JSON.stringify({'userName':device.userName, 'message':message}) as string);
    }catch (error){
        console.log('Publisher Failed %s',(error as Error).message)
    }
}

//Test Endpoint to send data to client. This is only for testing the send to client function through postman
const sendWSMessageAPI = async (request: Request, response: Response, next: NextFunction) => {
    await submit_ws_message_to_queue(request.query.message as string, request.query.username as string)
    response.status(200).json({ "res": 'hi' });
}

app.get('/sendws', sendWSMessageAPI);

server.listen(process.env.SERVER_PORT, () => {
    console.log(`Server started on port ${(server.address() as AddressInfo).port}`);
});