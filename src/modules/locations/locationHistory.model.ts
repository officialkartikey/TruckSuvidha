import { Schema, model, Document, Types } from 'mongoose';

export interface ILocationHistory extends Document {
  _id: Types.ObjectId;
  deviceId: string;
  seq?: number | null;
  sessionId?: string | null;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: Date;
  receivedAt: Date;
}

const locationHistorySchema = new Schema<ILocationHistory>(
  {
    deviceId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    seq: {
      type: Number,
      required: false,
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: false,
      default: null,
      index: true,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    speed: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // Explicit timestamp and receivedAt are maintained
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound index for querying a device's historical trail sorted chronologically
locationHistorySchema.index({ deviceId: 1, timestamp: -1 });

// Unique compound index to prevent duplicate events for the same device at the exact same timestamp
locationHistorySchema.index({ deviceId: 1, timestamp: 1 }, { unique: true });

export const LocationHistory = model<ILocationHistory>('LocationHistory', locationHistorySchema);
