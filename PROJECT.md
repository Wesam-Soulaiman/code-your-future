# Code Your Future

## Overview

Full-stack monorepo with Parse Server backend and Angular frontend.

---

## Roles

| Role | Description |
|---|---|
| SuperAdmin | Full system access — manages all entities, users, and settings |
| Employee | Standard user |

---

## Entities

<!-- For each entity, document: description, field table, permissions, and special behavior. -->

### User

Authentication and identity entity (built-in Parse.User).

| Field | Description | Required |
|---|---|---|
| username | Unique login identifier | Yes |
| email | User email address | Yes |
| firstName | First name | No |
| lastName | Last name | No |

**Permissions:**
- View: SuperAdmin, Employee
- Create: SuperAdmin
- Update: SuperAdmin, Employee (own)
- Delete: SuperAdmin

<!-- === Add domain entities below this line === -->

---

## Entity Relationships

```
(empty — to be filled as entities are generated)
```

---

## Pages & Navigation

### Auth Page (`/auth`)
- Login form (username + password)
- Language toggle (English/Arabic)

### Dashboard (`/dashboard`)
- Placeholder — to be built per project

### Users (`/users`)
- Data table listing all users with roles
- Search by username or email

### Sidebar Navigation

| Item | Route | Icon | Roles |
|---|---|---|---|
| Users | `/users` | `fa-solid fa-users` | SuperAdmin, Employee |
| Employees | `/employees` | `fa-solid fa-id-badge` | SuperAdmin, Employee |

---

## Features

### Authentication
- Username/password login via Parse Server
- Session token stored in localStorage
- Logout destroys server-side session

### Multi-Language
- English and Arabic supported
- RTL/LTR auto-switching based on language
- Language preference persisted to localStorage

### Theming
- Light and dark mode
- Theme preference persisted to localStorage

### Data Table (Reusable)
- Lazy-loaded data with server-side pagination
- Debounced search
- Table and grid view modes
- Column visibility toggle
- Preview side panel with custom templates
- Export selected rows to Excel
- Skeleton loading states

<!-- === Add project-specific features below this line === -->

---

## Known Limitations

<!-- Track unfinished work, bugs, and technical debt here. -->

---

## Last Updated

2026-05-24 — Removed Microsoft (Entra ID) OAuth login, user sync, and all MS-derived User fields + the org-chart view.
