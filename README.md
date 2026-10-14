# Live GPS Tracking Backend — MVP

A robust, production-grade MVP backend for an IoT-based live GPS tracking system built with **Node.js**, **TypeScript**, **Express**, **MongoDB (Mongoose)**, and **Socket.IO**.

Engineered for hardware tracking units (ESP32 / MCU, GPS module, and cellular modem) transmitting telemetry to an administrative fleet dashboard with live map updates, dynamic status computation, and historical location trails.

---

## 1. Features & Highlights

- **Modular Monolith Architecture**: Clean separation into Auth, Devices, Locations, and Realtime modules with thin controllers and cohesive services.
- **Admin Authentication**: Multi-admin ready architecture. Admins register, log in, receive signed JWTs, and have strictly isolated ownership of their GPS devices.
- **Secure Device Provisioning**: Devices are authenticated independently from admins using hashed per-device API keys (`trk_...`). Device credentials are never stored in plaintext.
- **High-Throughput Location Ingestion**: Validates coordinates, speeds, timestamps, and battery levels using Zod schemas.
- **Offline Buffering & Out-of-Order Handling**:
  - Accepts delayed buffered uploads after cellular reconnects.
  - Automatically records historical points in `LocationHistory`.
  - Guarantees that older buffered timestamps never overwrite newer `latestLocation` coordinates on the device.
- **GPS Fix Resilience**: Non-fixed telemetry updates (`gpsFixed: false`) update device status and battery without corrupting or wiping out valid geographic coordinates.
- **Deduplication**: Fast indexed deduplication prevents network retries or firmware retransmissions from bloating location history.
- **Real-Time Live Tracking with Socket.IO**:
  - JWT-authenticated WebSocket handshake.
  - Strict ownership checks before granting room subscriptions (`tracking:subscribe`).
  - Targeted room emissions (`tracking:location` and `device:status`) ensure zero cross-admin data leakage.
- **Dynamic Online/Offline Status**: Computed dynamically using configurable heartbeat timeout thresholds (`DEVICE_OFFLINE_TIMEOUT_SECONDS`), distinguishing between online connectivity and valid GPS fixes.
- **Security & Reliability**:
  - `Helmet` HTTP security headers.
  - Configurable CORS.
  - Granular rate limiting (differentiated for standard admin APIs and high-frequency IoT device pings).
  - Graceful shutdown handling (`SIGINT`/`SIGTERM`) for HTTP, Socket.IO, and MongoDB.
  - Centralized error handling and structured logging.

---

## 2. Technology Stack

| Technology | Purpose |
| :--- | :--- |
| **Node.js (v20+)** | Runtime environment |
| **TypeScript (Strict Mode)** | End-to-end static type safety |
| **Express.js** | Minimalist web application framework |
| **MongoDB & Mongoose** | Document database with indexed schemas |
| **Socket.IO** | Bi-directional low-latency real-time communication |
| **Zod** | Schema and runtime request validation |
| **JWT (`jsonwebtoken`)** | Stateless admin authorization |
| **bcryptjs** | Adaptive password hashing for admin credentials |
| **Vitest & Supertest** | Automated unit, integration, and socket testing |
| **Docker & Docker Compose** | Containerized deployment with MongoDB service |

---

## 3. Project Structure

```
TruckSuvidha/
├── Dockerfile                   # Multi-stage production container build
├── docker-compose.yml           # Docker orchestration with MongoDB
├── tsconfig.json                # Strict TypeScript configuration
├── vitest.config.ts             # Vitest test runner configuration
├── package.json
├── .env.example                 # Environment configuration template
├── src/
│   ├── app.ts                   # Express application factory & middleware setup
│   ├── server.ts                # HTTP server, Socket.IO init, and graceful shutdown
│   ├── config/
│   │   ├── env.ts               # Validated environment configuration with Zod
│   │   └── database.ts          # Mongoose connection with lifecycle hooks
│   ├── middleware/
│   │   ├── auth.middleware.ts       # Admin JWT verification
│   │   ├── deviceAuth.middleware.ts # Device API key verification
│   │   ├── errorHandler.middleware.ts # Centralized error & exception handling
│   │   ├── rateLimiter.middleware.ts  # Standard & IoT device rate limiters
│   │   └── validate.middleware.ts   # Zod body & query validator
│   ├── modules/
│   │   ├── auth/                # Admin registration, login & JWT tokens
│   │   │   ├── admin.model.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.schema.ts
│   │   │   └── auth.service.ts
│   │   ├── devices/             # Device CRUD, ownership & status computation
│   │   │   ├── device.model.ts
│   │   │   ├── devices.controller.ts
│   │   │   ├── devices.routes.ts
│   │   │   ├── devices.schema.ts
│   │   │   └── devices.service.ts
│   │   ├── locations/           # GPS telemetry ingestion & history
│   │   │   ├── locationHistory.model.ts
│   │   │   ├── locations.controller.ts
│   │   │   ├── locations.routes.ts
│   │   │   ├── locations.schema.ts
│   │   │   └── locations.service.ts
│   │   └── realtime/            # Socket.IO connection & event handlers
│   │       ├── socket.handler.ts
│   │       └── socket.service.ts
│   └── utils/
│       ├── apiResponse.ts       # Standardized API response formatters
│       ├── crypto.ts            # High-entropy API key generation & hashing
│       └── logger.ts            # Structured development/production logger
└── tests/
    ├── setup.ts                 # In-memory MongoDB testing environment
    ├── auth.test.ts             # Admin auth & validation test suite
    ├── devices.test.ts          # Device CRUD & ownership isolation tests
    ├── location.test.ts         # Ingestion, dedup & out-of-order tests
    └── realtime.test.ts         # Socket.IO auth & live subscription tests
```

---

## 4. Getting Started

### Prerequisites

- Node.js `v20.x` or `v22.x`
- npm `v10.x` or higher
- MongoDB instance running locally on `mongodb://localhost:27017` (or Docker)

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd TruckSuvidha
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run the development server with live reload:
   ```bash
   npm run dev
   ```

The server starts on `http://localhost:4000`.

---

## 5. Running with Docker Compose

To spin up both MongoDB and the backend service in an isolated Docker environment:

```bash
docker compose up --build
```

To stop the containers:
```bash
docker compose down
```

---

## 6. Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP server port | `4000` |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `MONGODB_URI` | MongoDB connection connection string | `mongodb://localhost:27017/trucksuvidha_gps` |
| `JWT_SECRET` | Secret key used to sign Admin JWTs (minimum 16 characters) | — |
| `JWT_EXPIRES_IN` | Lifespan of issued JWTs | `7d` |
| `CORS_ORIGIN` | Allowed CORS origins (`*` or comma-separated list) | `*` |
| `DEVICE_OFFLINE_TIMEOUT_SECONDS` | Heartbeat threshold in seconds to determine if a device is offline | `120` |
| `RATE_LIMIT_WINDOW_MS` | Rate limiting evaluation window in milliseconds | `60000` (1 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Maximum requests per window for standard admin APIs | `100` |
| `DEVICE_RATE_LIMIT_MAX_REQUESTS`| Maximum requests per window for device telemetry ingestion | `600` |

---

## 7. API Reference

All responses follow a consistent format:
```json
{
  "success": true,
  "message": "Optional descriptive status message",
  "data": { ... }
}
```

In the event of an error:
```json
{
  "success": false,
  "message": "Error description",
  "error": {
    "code": "ERROR_CODE",
    "details": [ ... ]
  }
}
```

### 7.1. Admin Authentication (`/api/v1/auth`)

#### `POST /api/v1/auth/register`
Register a new administrator account.

**Request Body:**
```json
{
  "name": "Alex Johnson",
  "email": "alex@fleetcorp.com",
  "password": "Password123!"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Admin registered successfully",
  "data": {
    "admin": {
      "id": "670bf60b...",
      "email": "alex@fleetcorp.com",
      "name": "Alex Johnson"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ik..."
  }
}
```

---

#### `POST /api/v1/auth/login`
Authenticate an admin and receive a JWT.

**Request Body:**
```json
{
  "email": "alex@fleetcorp.com",
  "password": "Password123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "admin": {
      "id": "670bf60b...",
      "email": "alex@fleetcorp.com",
      "name": "Alex Johnson"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ik..."
  }
}
```

---

### 7.2. Device Management (`/api/v1/devices`)
*All endpoints require the `Authorization: Bearer <admin-jwt>` header.*

#### `POST /api/v1/devices`
Register a new tracking device and generate its secret API key.

**Request Body:**
```json
{
  "deviceId": "ESP32_001",
  "name": "Tata Signa 4825.TK - Truck #01"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Device registered successfully",
  "data": {
    "device": {
      "id": "670bf70c...",
      "deviceId": "ESP32_001",
      "ownerAdminId": "670bf60b...",
      "name": "Tata Signa 4825.TK - Truck #01",
      "latestLocation": null,
      "batteryPercent": null,
      "lastSeenAt": null,
      "status": "offline",
      "createdAt": "2026-10-13T12:00:00.000Z",
      "updatedAt": "2026-10-13T12:00:00.000Z"
    },
    "apiKey": "trk_7f8a9e2b1c4d6f0a5b8c9d0e1f2a3b4c5d6e7f8a"
  }
}
```
> [!IMPORTANT]
> The plain `apiKey` is returned **only once** upon registration. Securely store it in the device firmware's non-volatile memory (NVS/Flash).

---

#### `GET /api/v1/devices`
List all devices registered by the authenticated admin. Status is dynamically evaluated based on `lastSeenAt`.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Devices retrieved successfully",
  "data": [
    {
      "id": "670bf70c...",
      "deviceId": "ESP32_001",
      "name": "Tata Signa 4825.TK - Truck #01",
      "latestLocation": {
        "latitude": 25.5701,
        "longitude": 81.5,
        "speed": 42.5,
        "timestamp": "2026-10-13T12:30:00.000Z",
        "gpsFixed": true
      },
      "batteryPercent": 85,
      "lastSeenAt": "2026-10-13T12:30:02.150Z",
      "status": "online"
    }
  ]
}
```

---

#### `GET /api/v1/devices/:deviceId`
Get detailed information for a specific device.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Device details retrieved successfully",
  "data": {
    "id": "670bf70c...",
    "deviceId": "ESP32_001",
    "name": "Tata Signa 4825.TK - Truck #01",
    "status": "online",
    "batteryPercent": 85,
    "lastSeenAt": "2026-10-13T12:30:02.150Z",
    "latestLocation": { ... }
  }
}
```

---

#### `PATCH /api/v1/devices/:deviceId`
Update device metadata (e.g. name).

**Request Body:**
```json
{
  "name": "Tata Prima 5530.S - Route A"
}
```

---

#### `DELETE /api/v1/devices/:deviceId`
Delete a device and purge its associated location history with strict ownership checks.

---

#### `POST /api/v1/devices/:deviceId/rotate-key`
Provision a replacement API key for a device if compromised or reassigned.

---

#### `GET /api/v1/devices/:deviceId/locations`
Query the historical GPS trail of a device.

**Query Parameters:**
- `limit` *(optional, default 50, max 500)*
- `from` *(optional, ISO 8601 string)*
- `to` *(optional, ISO 8601 string)*

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Location history retrieved successfully",
  "data": [
    {
      "_id": "670bfa01...",
      "deviceId": "ESP32_001",
      "latitude": 25.5701,
      "longitude": 81.5,
      "speed": 42.5,
      "timestamp": "2026-10-13T12:30:00.000Z",
      "receivedAt": "2026-10-13T12:30:02.150Z"
    }
  ]
}
```

---

### 7.3. Device Location Ingestion (`/api/v1/device/location`)

Hardware devices authenticate separately using their provisioned API key.

**Endpoint:** `POST /api/v1/device/location`  
**Headers:**
- `x-device-key: <device-api-key>` *(or `Authorization: Bearer <device-api-key>`)*
- `Content-Type: application/json`

**Payload:**
```json
{
  "deviceId": "ESP32_001",
  "timestamp": "2026-10-13T12:30:00Z",
  "latitude": 25.5701,
  "longitude": 81.5000,
  "speed": 12.5,
  "gpsFixed": true,
  "batteryPercent": 85
}
```

**Ingestion Behavior:**
1. **Device Authentication**: Checks whether `deviceId` exists and the API key matches the stored SHA-256 hash.
2. **`lastSeenAt` & Battery**: Always updated on valid authenticated requests, setting device status to `online`.
3. **When `gpsFixed` is `false`**:
   - Accepts the telemetry status and battery.
   - Retains the device's existing latest valid GPS coordinates without wiping them.
4. **When `gpsFixed` is `true`**:
   - **Deduplication**: Drops identical `(deviceId, timestamp)` records so network retransmissions don't duplicate history.
   - **Out-of-Order / Delayed Buffers**: Saves the point in `LocationHistory`. If `timestamp < device.latestLocation.timestamp`, it does **not** overwrite the newer location coordinates.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Location updated and stored successfully",
  "data": {
    "deviceId": "ESP32_001",
    "gpsFixed": true,
    "receivedAt": "2026-10-13T12:30:01.890Z",
    "latestLocationUpdated": true,
    "historySaved": true,
    "message": "Location updated and stored successfully"
  }
}
```

---

## 8. Real-Time Tracking with Socket.IO

The backend provides real-time location streaming over WebSockets.

### Connection & Authentication

Admins authenticate the Socket connection by providing their JWT in the handshake:
```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: {
    token: "<admin-jwt-token>"
  }
});
```

### Client-to-Server Events

#### `tracking:subscribe`
Subscribe to live location and status events for a specific device. The server verifies device ownership before joining the socket to room `device:<deviceId>`.

```javascript
socket.emit("tracking:subscribe", { deviceId: "ESP32_001" });
```

#### `tracking:unsubscribe`
Unsubscribe from a device's updates.
```javascript
socket.emit("tracking:unsubscribe", { deviceId: "ESP32_001" });
```

### Server-to-Client Events

#### `tracking:subscribed`
Emitted immediately upon successful subscription with current device state:
```json
{
  "deviceId": "ESP32_001",
  "status": "online",
  "batteryPercent": 85,
  "latestLocation": {
    "latitude": 25.5701,
    "longitude": 81.5,
    "speed": 12.5,
    "timestamp": "2026-10-13T12:30:00.000Z",
    "gpsFixed": true
  },
  "lastSeenAt": "2026-10-13T12:30:01.890Z"
}
```

#### `tracking:location`
Emitted in real-time when the device posts a new valid GPS fix:
```json
{
  "deviceId": "ESP32_001",
  "latitude": 25.5701,
  "longitude": 81.5,
  "speed": 12.5,
  "timestamp": "2026-10-13T12:30:00.000Z",
  "gpsFixed": true,
  "receivedAt": "2026-10-13T12:30:01.890Z"
}
```

#### `device:status`
Emitted when device status, heartbeat, or battery percentage changes:
```json
{
  "deviceId": "ESP32_001",
  "status": "online",
  "batteryPercent": 85,
  "lastSeenAt": "2026-10-13T12:30:01.890Z",
  "gpsFixed": true
}
```

#### `tracking:error`
Emitted if an admin attempts to subscribe to an invalid or unauthorized device:
```json
{
  "message": "Access denied: You do not own this device",
  "code": "FORBIDDEN"
}
```

---

## 9. Firmware Guidelines for Hardware Devices

When programming the ESP32 / cellular modem firmware:

1. **Cellular Disconnection & Offline Buffering**:
   - Store unsent GPS fixes in local flash/SPIFFS/SD card buffer when cellular reception is dropped.
   - Upon reconnecting to the cellular network, upload queued points in FIFO order.
   - The backend accepts buffered historical timestamps and saves them in `LocationHistory` without overwriting more recent coordinates on the live dashboard.
2. **Fixed Retries**:
   - In case of network timeout, retrying with the same timestamp is safe; the backend deduplicates identical events.
3. **No GPS Fix**:
   - If the vehicle enters a tunnel or underground garage, send `gpsFixed: false` along with the current battery level. The backend will record the heartbeat without disturbing the last known map marker.

---

## 10. Automated Tests & Scripts

The test suite runs with an isolated in-memory MongoDB server, requiring no external database:

```bash
# Run all unit, integration, and Socket.IO tests
npm test

# Run tests in watch mode
npm run test:watch

# Run TypeScript typecheck
npm run typecheck

# Build for production
npm run build

# Start production build
npm start
```

---

## 11. Production Deployment & Security Best Practices

1. **Enforce HTTPS / WSS**: In production, deploy behind a reverse proxy (e.g. Nginx, AWS ALB, Caddy) terminating TLS/SSL.
2. **Environment Secrets**: Never commit `.env` or production secrets into version control. Rotate `JWT_SECRET` periodically.
3. **Database Security**: Connect to MongoDB over TLS with authentication enabled.
4. **Device Keys**: Store the provisioned `apiKey` in encrypted device storage (e.g., ESP32 NVS encryption / secure boot).
