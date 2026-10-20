import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { createAuth, type Auth } from './better-auth.js';

@Injectable()
export class AuthService {
  readonly auth: Auth;

  constructor(db: DbService) {
    this.auth = createAuth(db.db);
  }
}
