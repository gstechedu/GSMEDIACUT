import { NextResponse } from "next/server";
import { listLocalDraftProjects } from "@/lib/local-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const drafts = await listLocalDraftProjects();
		return NextResponse.json({ drafts });
	} catch (error) {
		console.error("Failed to load local drafts:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to load local drafts",
			},
			{ status: 500 },
		);
	}
}
