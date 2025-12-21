import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

// Polyfill for Node 18 (Render)
if (!(global as any).crypto) {
  (global as any).crypto = {
    randomUUID: randomUUID,
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);


  app.set('trust proxy', true);

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',       
    defaultVersion: '1',
  });

  // CORS
  const allowedOrigins = [
    'http://localhost:3000',
    'https://32-win.vercel.app',
    'https://lotto.redefyne.in',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('❌ CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Middleware
  app.use(cookieParser());

  // Global API prefix → /api
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // SWAGGER 
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lotto API')
    .setDescription('Backend API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'access-token',
    )
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 5000);
}

bootstrap();
