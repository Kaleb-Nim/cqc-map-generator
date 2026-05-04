import { pgTable, uuid, text, jsonb, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    status: text('status').notNull(),
    promptInputs: jsonb('prompt_inputs').notNull(),
    prompt: text('prompt').notNull(),
    modelParams: jsonb('model_params'),
    wavespeedTaskId: text('wavespeed_task_id'),
    blobUrl: text('blob_url'),
    blobPathname: text('blob_pathname'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_generations_device_id_created_at').on(t.deviceId, t.createdAt.desc()),
    index('idx_generations_created_at').on(t.createdAt.desc()),
  ],
);

export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
