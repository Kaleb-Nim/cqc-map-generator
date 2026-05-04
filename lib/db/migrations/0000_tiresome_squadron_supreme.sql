CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"status" text NOT NULL,
	"prompt_inputs" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"model_params" jsonb,
	"wavespeed_task_id" text,
	"blob_url" text,
	"blob_pathname" text,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_generations_device_id_created_at" ON "generations" USING btree ("device_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_generations_created_at" ON "generations" USING btree ("created_at" DESC NULLS LAST);