import './instrumentation.js';
import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { config } from './config.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), { rawBody: true });
app.setGlobalPrefix('api');
await app.register(fastifyCookie, { secret: config.sessionSecret });
app.enableShutdownHooks();
await app.listen(config.port, '0.0.0.0');
console.log(`API listening on ${config.port}`);
