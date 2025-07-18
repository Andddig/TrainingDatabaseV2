# BVAR Training Database

A comprehensive training management system for BVAR19 volunteer ambulance company members. This web-based platform streamlines training record management, certification tracking, and qualification compliance for emergency medical services personnel.

## Overview

The BVAR Training Database is designed to support the three key roles in emergency medical training:

- **Students** - Upload training evidence, track progress, and manage certifications
- **Approvers** - Validate submitted evidence and award training hours  
- **Training Officers** - Create classes, design qualification rules, audit compliance, and generate regulatory reports

## Key Features

### 🎓 Training Management
- **Certificate Submission** - Upload and track training certificates (PDF/images)
- **Class Registration** - Find and register for Fire, EMS, Rescue, and Management classes
- **Hours Tracking** - Automatically calculate and track training hours
- **Progress Monitoring** - Real-time qualification progress tracking

### 👥 Role-Based Access Control
- **Microsoft SSO Integration** - Secure authentication via BVAR19 organization accounts
- **Multi-Role Support** - Students, Approvers, and Training Officers with appropriate permissions
- **Admin Dashboard** - User management and system administration

### 📋 Compliance & Reporting
- **Qualification Tracking** - Monitor progress toward required certifications
- **Approval Workflow** - Structured review and validation of training submissions
- **Audit Trail** - Complete history of all training activities and approvals
- **Regulatory Compliance** - Generate reports for state and federal requirements

### 🔍 Class Discovery
- **MFRI Integration** - Search Maryland Fire and Rescue Institute classes
- **Category Filtering** - Filter by Fire, EMS, Rescue, or Management training
- **Prerequisites Management** - Track and enforce training prerequisites

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Microsoft Azure Account (for SSO configuration)
- MongoDB database

### Environment Setup

Create a `.env` file with the following configuration:

```env
# Session Security
SESSION_SECRET=your_secure_random_string

# Microsoft Azure SSO
MICROSOFT_CLIENT_ID=your_azure_app_client_id
MICROSOFT_CLIENT_SECRET=your_azure_app_client_secret
MICROSOFT_TENANT_ID=your_azure_tenant_id
CALLBACK_URL=http://your-domain:3000/auth/microsoft/callback

# Database
MONGODB_URI=mongodb://mongodb:27017/training_database
```

### Running with Docker

```bash
# Start the application
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop the application
docker-compose down
```

### First-Time Setup

1. The first user with email `adavis@bvar19.org` will automatically receive admin privileges
2. Admin users can then assign roles to other users via the Admin Panel
3. Training Officers can begin creating training classes and qualification requirements

## User Workflows

### For Students
1. **Submit Training** - Upload certificates and training documentation
2. **Track Progress** - Monitor qualification requirements and completion status
3. **Find Classes** - Search for available training opportunities
4. **View History** - Access complete training record and achievements

### For Approvers
1. **Review Submissions** - Validate uploaded training certificates
2. **Award Hours** - Approve and assign training hours to student records
3. **Add Comments** - Provide feedback on submissions
4. **Track Workload** - Monitor pending approvals and completion rates

### For Training Officers
1. **Manage Classes** - Create and maintain training class catalog
2. **Design Qualifications** - Define requirements and prerequisites
3. **Audit Compliance** - Review system-wide training compliance
4. **Generate Reports** - Create regulatory and administrative reports

## Technical Architecture

- **Backend**: Node.js with Express framework
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Microsoft OAuth 2.0 / OpenID Connect
- **File Storage**: Local filesystem with multer for certificate uploads
- **Frontend**: EJS templating with Bootstrap 4 styling
- **Deployment**: Docker containerization for easy deployment

## Azure SSO Configuration

1. Register application in [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory > App registrations
3. Set redirect URI: `http://your-domain:3000/auth/microsoft/callback`
4. Configure organizational directory access for BVAR19.org accounts
5. Generate client secret and note application/tenant IDs

## Security Features

- **Secure Authentication** - Microsoft SSO with organization account restrictions
- **Role-Based Permissions** - Granular access control by user role
- **File Upload Security** - Validated file types and size limits
- **Session Management** - Secure session handling with MongoDB store
- **Input Validation** - Comprehensive server-side validation

## Support & Maintenance

This system is designed for BVAR19's specific training compliance requirements. For technical support or feature requests, contact the system administrator.

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Organization**: BVAR19 Volunteer Ambulance Company 