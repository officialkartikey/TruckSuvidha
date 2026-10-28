import { Schema, model, Document, Types } from 'mongoose';

export interface ILatestLocation {
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: Date;
  gpsFixed: boolean;
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
