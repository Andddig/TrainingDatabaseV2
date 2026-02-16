const mongoose = require('mongoose');

const ratingValues = ['S', 'NI', 'F', 'NA'];

const skillLineSchema = new mongoose.Schema({
  skill: { type: String, required: true },
  rating: { type: String, enum: ratingValues, default: 'NA' },
  comments: { type: String, default: '' }
}, { _id: false });

const signatureSchema = new mongoose.Schema({
  signedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  signedAt: { type: Date, default: null },
  name: { type: String, default: '' }
}, { _id: false });

const callSheetSchema = new mongoose.Schema({
  callNumber: { type: Number, min: 1, max: 12, required: true },
  candidateName: { type: String, default: '' },
  incidentDate: { type: Date, default: null },
  patientPriority: { type: String, default: '' },
  incidentType: { type: String, default: '' },
  fcIncidentNumber: { type: String, default: '' },
  directions: { type: String, default: '' },
  skillRatings: {
    type: [skillLineSchema],
    default: []
  },
  evaluatorComments: { type: String, default: '' },
  independentFieldReady: {
    value: { type: String, enum: ['yes', 'no', 'not_evaluated'], default: 'not_evaluated' },
    comments: { type: String, default: '' }
  },
  candidateSignature: { type: signatureSchema, default: () => ({}) },
  evaluatorSignature: { type: signatureSchema, default: () => ({}) },
  rescueOfficerSignature: { type: signatureSchema, default: () => ({}) },
  status: {
    type: String,
    enum: ['draft', 'awaiting_candidate_signature', 'awaiting_evaluator_signature', 'awaiting_rescue_officer_signature', 'completed'],
    default: 'draft'
  },
  evaluatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rescueOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null }
}, {
  _id: false,
  timestamps: false
});

const attendantPacketSchema = new mongoose.Schema({
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sponsoringRescueOfficer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rescueChief: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  emtCompletionDate: { type: Date, default: null },
  secondAttendantStartDate: { type: Date, default: null },
  eligibilityPath: {
    type: String,
    enum: ['trips', 'one_year', 'qualified_elsewhere'],
    default: 'trips'
  },
  qualifiedElsewhereAgency: { type: String, default: '' },
  finalReview: {
    rescueChiefSignature: { type: signatureSchema, default: () => ({}) },
    firstAttendantCompletionDate: { type: Date, default: null },
    decision: {
      type: String,
      enum: ['pending', 'approved', 'pending_more_evaluation'],
      default: 'pending'
    },
    comments: { type: String, default: '' }
  },
  callSheets: {
    type: [callSheetSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['in_progress', 'pending_chief_review', 'approved', 'pending_more_evaluation'],
    default: 'in_progress'
  }
}, {
  timestamps: true
});

attendantPacketSchema.index({ candidate: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('AttendantPacket', attendantPacketSchema);
