import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitRunpodJob, submitRunpodSyncJob } from "@/lib/cloud/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
	mode: z.enum(["async", "sync"]).default("async"),
	input: z.record(z.string(), z.unknown()),
	webhook: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json();
		const parsed = requestSchema.safeParse(payload);

		if (!parsed.success) {
			return NextResponse.json(
				{
					error: "Invalid Runpod request",
					details: parsed.error.flatten().fieldErrors,
				},
				{ status: 400 },
			);
		}

		const result =
			parsed.data.mode === "sync"
				? await submitRunpodSyncJob({
						input: parsed.data.input,
						webhook: parsed.data.webhook,
					})
				: await submitRunpodJob({
						input: parsed.data.input,
						webhook: parsed.data.webhook,
					});

		return NextResponse.json(result);
	} catch (error) {
		console.error("Runpod job submission failed:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Runpod job submission failed",
			},
			{ status: 500 },
		);
	}
}
