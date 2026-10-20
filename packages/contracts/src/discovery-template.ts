/** The fixed Shopify discovery template, docs/phase-1-foundation.md section 6.3. Agencies cannot edit it in Phase 1. */
export const DISCOVERY_TEMPLATE_VERSION = 'shopify-discovery-v1';

export const DISCOVERY_SECTIONS = [
  { id: 'storeContext', title: 'Store context', prompt: 'Shopify plan, markets, current theme or storefront, apps already in use.' },
  { id: 'businessOutcome', title: 'Business outcome', prompt: 'Why this engagement exists, and the KPIs to move.' },
  { id: 'deliveryShape', title: 'Delivery shape', prompt: 'Theme change, custom app, Hydrogen or headless, or hybrid, plus the reasons.' },
  { id: 'integrations', title: 'Integrations', prompt: 'ERP, PIM, payments, subscriptions, and other systems the store depends on.' },
  { id: 'constraints', title: 'Constraints', prompt: 'Shopify platform limits, timeline, budget, and compliance limits the team already knows.' },
  { id: 'risks', title: 'Risks', prompt: 'What can make the launch miss, with impact and mitigation.' },
  { id: 'requirements', title: 'Requirements', prompt: 'Statements a story could implement.' },
  { id: 'recommendation', title: 'Recommendation', prompt: 'The chosen shape and the reasons, tied to the answers above.' },
] as const;

export type DiscoverySectionId = (typeof DISCOVERY_SECTIONS)[number]['id'];

export const APPROACHES = [
  { id: 'theme', label: 'Shopify theme' },
  { id: 'custom_app', label: 'Custom app' },
  { id: 'headless', label: 'Hydrogen or headless storefront' },
  { id: 'hybrid', label: 'Hybrid' },
] as const;

export const KPI_CATALOG = {
  business: [
    'Conversion rate',
    'Average order value',
    'Revenue per visitor',
    'Checkout completion rate',
    'Cart abandonment rate',
    'Repeat purchase rate',
    'Customer acquisition cost',
    'Subscription retention',
    'Returns rate',
  ],
  technical: [
    'Largest Contentful Paint',
    'Interaction to Next Paint',
    'Cumulative Layout Shift',
    'Lighthouse performance score',
    'Storefront error rate',
    'App uptime',
    'API response time p95',
    'Theme app extension count',
    'Third-party script weight',
  ],
  delivery: ['Launch date', 'Deployment frequency target', 'Change lead time target', 'Defect escape target'],
} as const;
