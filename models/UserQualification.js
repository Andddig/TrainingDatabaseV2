const mongoose = require('mongoose');

const userQualificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  qualification: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Qualification',
    required: true
  },
  isComplete: {
    type: Boolean,
    default: false
  },
  completedClasses: [{
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TrainingClass'
    },
    submission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TrainingSubmission'
    },
    completedDate: Date
  }],
  missingClasses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrainingClass'
  }],
  earnedDate: Date,
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Create a compound index on user and qualification to ensure uniqueness
userQualificationSchema.index({ user: 1, qualification: 1 }, { unique: true });

module.exports = mongoose.model('UserQualification', userQualificationSchema); 