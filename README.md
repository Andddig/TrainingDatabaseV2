# BVAR19 Portal

A secure web portal for BVAR19.org with Microsoft SSO authentication.

## Features

- Microsoft Single Sign-On (SSO) for BVAR19.org organization accounts
- User authentication and authorization
- Personalized welcome page
- Admin panel for user management
- Docker containerization for Unraid deployment

## Prerequisites

- Docker and Docker Compose
- Microsoft Azure Account (for registering the application for SSO)
- Unraid Server (for deployment)

## Azure Application Setup

1. Go to the [Azure Portal](https://portal.azure.com/)
2. Navigate to "Azure Active Directory" > "App registrations" > "New registration"
3. Enter a name for your application (e.g., "BVAR19 Portal")
4. Select "Accounts in this organizational directory only"
5. Add a Redirect URI: `http://your-domain:3000/auth/microsoft/callback` 
   (replace `your-domain` with your actual domain or IP)
6. Click "Register"
7. Note the "Application (client) ID" and "Directory (tenant) ID"
8. Navigate to "Certificates & secrets" > "New client secret"
9. Create a new client secret and note the value (visible only once)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
SESSION_SECRET=your_secure_random_string
MICROSOFT_CLIENT_ID=your_azure_app_client_id
MICROSOFT_CLIENT_SECRET=your_azure_app_client_secret
MICROSOFT_TENANT_ID=your_azure_tenant_id
CALLBACK_URL=http://your-domain:3000/auth/microsoft/callback
```

## Running in Docker

### Local Development

```bash
# Build and start the containers
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop containers
docker-compose down
```

### Unraid Deployment

1. Create a new Docker container in Unraid
2. Use the following settings:
   - Repository: `path-to-your-image` or use Docker Compose with Compose Manager plugin
   - Network Type: Bridge
   - Port Mappings: `3000:3000`
   - Add environment variables from the `.env` file
   - Set volume mappings for persistent data (MongoDB and application files)

3. If using Docker Compose directly:
   - Install "Docker Compose Manager" plugin in Unraid
   - Upload the `docker-compose.yml` file
   - Set the necessary environment variables
   - Start the stack

## First Login and Admin Setup

The first time a user with the email `adavis@bvar19.org` logs in, they will automatically be assigned admin privileges.

The admin user can then:
1. Access the Admin Panel via the navigation menu
2. View all registered users
3. Grant admin privileges to other users

## Custom Modifications

- Modify the views in the `views/` directory to customize the user interface
- Update styles in `public/css/styles.css`
- Add custom logic in `server.js`

## Security Considerations

- Always use HTTPS in production
- Set strong secrets for session encryption
- Regularly update dependencies to fix security vulnerabilities
- Consider implementing rate limiting for login attempts
- Review Microsoft OAuth permissions and scopes 