const mongoose = require('mongoose');

const attendantProgressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  calls: {
    type: Map,
    of: {
      incident: String,
      type: String,
      disposition: String,
      completed: Boolean
    },
    default: {}
  },
  completedCalls: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AttendantProgress', attendantProgressSchema); 