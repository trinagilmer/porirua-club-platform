# 📬 Communication Integration Blueprint  
**Porirua Club Platform – Microsoft 365 Graph Integration**  
_Last updated: October 2025_

---

## 🔍 Overview

The **Communication System** centralizes all inbound and outbound correspondence between staff, clients, and the Porirua Club Platform.

It integrates with **Microsoft 365 (Outlook)** via the **Graph API**, using a **shared mailbox** (e.g., `events@poriruaclub.co.nz`) to send, receive, and log emails related to:
- **Functions**
- **Restaurant bookings**
- **Club events**
- **General contact enquiries**

All communications are logged in the database and automatically linked to the relevant **contact** and **function/booking**.

---

## ⚙️ Components

### 1. Microsoft Graph Integration

**Purpose:**  
Authenticate via Azure AD and access emails through Microsoft Graph using delegated permissions.

**Setup:**
- Register an Azure AD App  
- Add permissions:
  - `Mail.ReadWrite.Shared`
  - `Mail.Send.Shared`
  - `User.Read`
  - `offline_access`
- Create a **shared mailbox** (recommended: `events@poriruaclub.co.nz`)
- Grant “Send As” and “Full Access” permissions to relevant staff

**Environment Variables:**
```env
AZURE_CLIENT_ID=<your Azure App ID>
AZURE_TENANT_ID=<your Azure Tenant ID>
AZURE_CLIENT_SECRET=<your Azure App Secret>
AZURE_REDIRECT_URI=https://porirua-club-platform.onrender.com/auth/graph/callback
SHARED_MAILBOX=events@poriruaclub.co.nz
