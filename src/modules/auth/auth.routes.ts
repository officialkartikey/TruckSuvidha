import { Router } from 'express';
import { authController } from './auth.controller';
import { validateBody } from '../../middleware/validate.middleware';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

router.post('/register', validateBody(registerSchema), (req, res, next) => {
  authController.register(req, res, next);
});

router.post('/login', validateBody(loginSchema), (req, res, next) => {
  authController.login(req, res, next);
});

export const authRoutes = router;
