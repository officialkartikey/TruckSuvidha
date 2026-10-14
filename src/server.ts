import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { socketService } from './modules/realtime/socket.service';
import { setupSocketHandlers } from './modules/realtime/socket.handler';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Initialize Express and HTTP Server
    const app = createApp();
    const server = http.createServer(app);

    // 3. Initialize Socket.IO
    const io = new SocketIOServer(server, {
      cors: {
        origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 30000,
      pingInterval: 10000,
    });

    socketService.init(io);
    setupSocketHandlers(io);

    // 4. Start HTTP Server
    server.listen(env.PORT, () => {
      logger.info(`🚀 TruckSuvidha Live GPS Tracking Backend running on port ${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Health check: http://localhost:${env.PORT}/health`);
    });

    // 5. Graceful Shutdown Management
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        // Close Socket.IO connections
        io.close(() => {
          logger.info('Socket.IO connections closed');
        });

        // Disconnect MongoDB
        try {
          await disconnectDatabase();
          logger.info('Database connection closed cleanly');
          process.exit(0);
        } catch (err) {
          logger.error('Error during database disconnection:', err);
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds if graceful close hangs
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });
  } catch (error) {
    logger.error('Fatal error during application startup:', error);
    process.exit(1);
  }
}

// Start application if executed directly
if (require.main === module) {
  bootstrap();
}

export { bootstrap };
