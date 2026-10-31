import { Schema, model, Document, Types } from 'mongoose';

export interface ILatestLocation {
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: Date;
  gpsFixed: boolean;
  accuracy?: number | null;
  source?: 'GNSS' | 'CELLULAR' | string | null;
}

export interface IDevice extends Document {
  _id: Types.ObjectId;
  deviceId: string;
  ownerAdminId: Types.ObjectId;
  name: string;
  apiKeyHash: string;
  latestLocation?: ILatestLocation | null;
  batteryPercent?: number | null;
  lastSeenAt?: Date | null;
  lastSeq?: number | null;
  sessionId?: string | null;
  sessionStartTime?: Date | null;
  status: 'online' | 'offline';
  smsSenderNumber?: string | null;
  smsEnabled: boolean;
  lastSmsSequence?: number | null;
  lastSmsReceivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const latestLocationSchema = new Schema<ILatestLocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speed: { type: Number, required: true, default: 0 },
    timestamp: { type: Date, required: true },
    gpsFixed: { type: Boolean, required: true, default: true },
    accuracy: { type: Number, default: null },
    source: { type: String, default: null },
  },
  { _id: false }
);

const deviceSchema = new Schema<IDevice>(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    ownerAdminId: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    apiKeyHash: {
      type: String,
      required: true,
    },
    latestLocation: {
      type: latestLocationSchema,
      default: null,
    },
    batteryPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    lastSeq: {
      type: Number,
      default: null,
    },
    sessionId: {
      type: String,
      default: null,
      trim: true,
    },
    sessionStartTime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline',
    },
    smsSenderNumber: {
      type: String,
      default: null,
      trim: true,
    },
    smsEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastSmsSequence: {
      type: Number,
      default: null,
    },
    lastSmsReceivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.apiKeyHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound index for querying an admin's devices efficiently
deviceSchema.index({ ownerAdminId: 1, createdAt: -1 });

export const Device = model<IDevice>('Device', deviceSchema);
