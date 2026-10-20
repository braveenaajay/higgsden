import { Module } from '@nestjs/common';
import { AgencyController } from './agency/agency.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { BillingController, StripeWebhookController } from './billing/billing.controller.js';
import { AiController } from './ai/ai.controller.js';
import { DbModule } from './db/db.module.js';
import { DeliveryController } from './delivery/delivery.controller.js';
import { DeskController, WidgetController } from './desk/desk.controller.js';
import { GitHubController, GitHubWebhookController } from './github/github.controller.js';
import { HealthController } from './health.controller.js';
import { HostingController } from './hosting/hosting.controller.js';
import { IntelligenceController } from './intelligence/intelligence.controller.js';
import { BacklogController } from './project/backlog.controller.js';
import { DiscoveryController } from './project/discovery.controller.js';
import { DecisionController, KnowledgeController, ProjectController } from './project/project.controller.js';
import { ProvisionController } from './provision/provision.controller.js';
import { OperatorController, SupportController } from './support/support.controller.js';
import { TestController } from './test/test.controller.js';
import { config } from './config.js';

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    AuthController,
    AgencyController,
    BillingController,
    StripeWebhookController,
    SupportController,
    OperatorController,
    ProjectController,
    DiscoveryController,
    BacklogController,
    DecisionController,
    KnowledgeController,
    GitHubController,
    GitHubWebhookController,
    DeliveryController,
    HostingController,
    ProvisionController,
    AiController,
    DeskController,
    WidgetController,
    IntelligenceController,
    ...(config.testApi ? [TestController] : []),
  ],
})
export class AppModule {}
