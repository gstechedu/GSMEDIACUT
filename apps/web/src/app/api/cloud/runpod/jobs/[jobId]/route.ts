import { NextResponse } from "next/server";
import { z } from "zod";
import { getRunpodJobStatus } from "@/lib/cloud/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
	jobId: z.string().min(1),
});

export async function GET(
	_request: Request,
	context: { params: Promise<{ jobId: string }> },
) {
	try {
		const params = await context.params;
		const parsed = paramsSchema.safeParse(params);

		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid Runpod job id" },
				{ status: 400 },
			);
		}

		const result = await getRunpodJobStatus({ jobId: parsed.data.jobId });
		return NextResponse.json(result);
	} catch (error) {
		console.error("Runpod status fetch failed:", error);
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : "Runpod status failed",
			},
			{ status: 500 },
		);
	}
}
