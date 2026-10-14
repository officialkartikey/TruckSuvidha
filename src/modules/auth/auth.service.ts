import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin, IAdmin } from './admin.model';
import { RegisterInput, LoginInput } from './auth.schema';
import { AppError } from '../../middleware/errorHandler.middleware';
import { env } from '../../config/env';

export interface AdminPayload {
  id: string;
  email: string;
  name: string;
}

export class AuthService {
  async register(input: RegisterInput): Promise<{ admin: AdminPayload; token: string }> {
    const existingAdmin = await Admin.findOne({ email: input.email });
    if (existingAdmin) {
      throw new AppError('An admin with this email already exists', 409, 'EMAIL_EXISTS');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(input.password, saltRounds);

    const admin = await Admin.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });

    const token = this.generateToken(admin);

    return {
      admin: {
        id: admin._id.toString(),
        email: admin.email,
        name: admin.name,
      },
      token,
    };
  }

  async login(input: LoginInput): Promise<{ admin: AdminPayload; token: string }> {
    const admin = await Admin.findOne({ email: input.email });
    if (!admin) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, admin.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const token = this.generateToken(admin);

    return {
      admin: {
        id: admin._id.toString(),
        email: admin.email,
        name: admin.name,
      },
      token,
    };
  }

  generateToken(admin: IAdmin): string {
    return jwt.sign(
      {
        id: admin._id.toString(),
        email: admin.email,
        name: admin.name,
      },
      env.JWT_SECRET,
      {
        expiresIn: env.JWT_EXPIRES_IN as any,
      }
    );
  }

  verifyToken(token: string): AdminPayload {
    return jwt.verify(token, env.JWT_SECRET) as AdminPayload;
  }
}

export const authService = new AuthService();
