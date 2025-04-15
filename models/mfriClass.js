const mongoose = require('mongoose');

const mfriClassSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    courseId: {
        type: String,
        required: true,
        unique: true
    },
    region: {
        type: String,
        required: true,
        default: 'North Central'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    classTimes: [{
        day: String,
        startTime: String,
        endTime: String
    }],
    location: {
        type: String,
        required: true
    },
    registrationOpen: {
        type: Date,
        required: true
    },
    registrationClose: {
        type: Date,
        required: true
    },
    instructionalHours: {
        type: Number,
        required: true
    },
    registrationUrl: {
        type: String,
        required: true
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('MfriClass', mfriClassSchema); 