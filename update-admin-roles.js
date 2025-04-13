require('dotenv').config();
const mongoose = require('mongoose');

console.log('Starting admin roles update...');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    updateAdminRoles();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define User model schema for this script
const userSchema = new mongoose.Schema({
  microsoftId: String,
  displayName: String,
  firstName: String,
  lastName: String,
  email: String,
  isAdmin: { type: Boolean, default: false },
  roles: { type: [String], default: ['Student'] },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

async function updateAdminRoles() {
  try {
    // Update all existing users to have the Student role if they don't have any roles
    await User.updateMany(
      { roles: { $exists: false } },
      { $set: { roles: ['Student'] } }
    );
    console.log('Updated users without roles to have Student role');

    // Make sure adavis@bvar19.org has all roles
    const adminUser = await User.findOne({ email: 'adavis@bvar19.org' });
    
    if (adminUser) {
      adminUser.roles = ['Student', 'Approver', 'Training Officer'];
      await adminUser.save();
      console.log('Updated admin user with all roles');
    } else {
      console.log('Admin user not found');
    }

    // Update any user that is an admin but doesn't have proper roles
    const adminUsers = await User.find({ isAdmin: true });
    let count = 0;
    
    for (const user of adminUsers) {
      // Make sure admin users have all roles
      if (!user.roles || user.roles.length < 3) {
        user.roles = ['Student', 'Approver', 'Training Officer'];
        await user.save();
        count++;
      }
    }
    
    console.log(`Updated ${count} admin users with all roles`);
    console.log('Migration completed successfully');
    
    // Close the connection
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error updating roles:', error);
    mongoose.connection.close();
    process.exit(1);
  }
} 