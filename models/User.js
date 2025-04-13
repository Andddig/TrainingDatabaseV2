const mongoose = require('mongoose');

// User schema definition
const userSchema = new mongoose.Schema({
  microsoftId: String,
  displayName: String,
  firstName: String,
  lastName: String,
  email: {
    type: String,
    unique: true,
    required: true
  },
  isAdmin: { 
    type: Boolean, 
    default: false 
  },
  roles: {
    type: [String],
    enum: ['Student', 'Approver', 'Training Officer'],
    default: ['Student']
  },
  lastLogin: Date,
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Static method to find or create a user from Microsoft profile
userSchema.statics.findOrCreateFromMicrosoft = async function(profile) {
  try {
    // Check if user exists
    let user = await this.findOne({ microsoftId: profile.id });
    
    // If not, create a new user
    if (!user) {
      // Check if this is the designated admin email
      const isAdmin = profile.emails && 
                    profile.emails[0] && 
                    profile.emails[0].value === 'adavis@bvar19.org';
      
      // Check if a user with this email already exists but without Microsoft ID
      // This handles the case where a user was created via local auth first
      const existingUserByEmail = await this.findOne({ 
        email: profile.emails[0].value 
      });

      if (existingUserByEmail) {
        // Update existing user with Microsoft ID
        existingUserByEmail.microsoftId = profile.id;
        existingUserByEmail.lastLogin = new Date();
        return await existingUserByEmail.save();
      }
      
      // Create new user
      user = await this.create({
        microsoftId: profile.id,
        displayName: profile.displayName,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        email: profile.emails[0].value,
        isAdmin: isAdmin,
        roles: ['Student'], // Default role
        lastLogin: new Date()
      });
    } else {
      // Update last login time
      user.lastLogin = new Date();
      await user.save();
    }
    
    return user;
  } catch (error) {
    console.error('Error in findOrCreateFromMicrosoft:', error);
    throw error;
  }
};

// Create and export the model
const User = mongoose.model('User', userSchema);
module.exports = User; 