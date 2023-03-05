const mongoose = require('mongoose')



const iot_device_schema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
    unique: true
  },
  
  queueId: {
    type: String,
    required: true
  },

})

module.exports = mongoose.model('iot_device', iot_device_schema)