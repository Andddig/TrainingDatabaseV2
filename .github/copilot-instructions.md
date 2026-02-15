# Copilot Instructions for BVAR Training Database

## Project Overview
- **Purpose:** Web-based training management for BVAR19 EMS volunteers. Tracks training, certifications, and compliance for Students, Approvers, and Training Officers.
- **Stack:** Node.js (Express), MongoDB (Mongoose), EJS (Bootstrap 4), Microsoft SSO (OAuth2), Dockerized deployment.

## Architecture & Key Patterns
- **Backend:**
  - All business logic in `models/` (Mongoose schemas) and `routes/` (Express routers).
  - Role-based access enforced in route handlers (see `routes/` and `server.js`).
  - File uploads (certificates) handled via multer, stored in `public/uploads/`.
- **Frontend:**
  - EJS templates in `views/` (main) and `views/partials/` (shared UI).
  - Static assets in `public/` (CSS, JS, images).
- **Authentication:**
  - Microsoft SSO via Azure AD. See `.env` and `README.md` for required secrets.
  - First user with `adavis@bvar19.org` is auto-admin.
- **Data Model:**
  - Key schemas: `User`, `TrainingClass`, `Qualification`, `TrainingSubmission`, `AttendantProgress`.
  - Cross-references: Users link to submissions, classes, and qualifications.

## Developer Workflows
- **Run/Dev:**
  - Use Docker Compose: `docker-compose up -d` (see `README.md`).
  - Logs: `docker-compose logs -f app`.
  - Stop: `docker-compose down`.
- **Environment:**
  - Copy `.env` template from `README.md`.
  - MongoDB runs in Docker by default.
- **Role Management:**
  - Admin assigns roles via Admin Panel (see `views/admin-member-management.ejs`).
- **Class/Qualification Management:**
  - Training Officers manage via dashboard UIs (`views/manage-classes.ejs`, `views/manage-qualifications.ejs`).

## Project-Specific Conventions
- **Role Logic:**
  - Student, Approver, Training Officer roles are central—see `routes/` and `models/User.js`.
- **Approval Workflow:**
  - Submissions require Approver validation before hours/qualifications are awarded.
- **File Uploads:**
  - Only validated file types/sizes accepted (see multer config in backend).
- **SSO:**
  - Only BVAR19.org accounts permitted.

## Integration Points
- **MFRI Integration:**
  - Class search via Maryland Fire and Rescue Institute (see `routes/mfri.js`).
- **Azure SSO:**
  - Configured in Azure Portal; see `README.md` for setup.

## References
- **Key Files:**
  - `server.js` (entry point)
  - `models/` (data schemas)
  - `routes/` (API and page logic)
  - `views/` (UI templates)
  - `public/` (static assets)
  - `README.md` (setup, workflows)

---
For more details, see the full `README.md` and in-code comments. When in doubt, follow the established role-based and approval workflows.
