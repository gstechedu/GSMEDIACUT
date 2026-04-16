import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_UPLOAD_DIR = path.join(os.tmpdir(), "gsmediacut-public-uploads");

function getUploadPaths(uploadId: string) {
	return {
		metadataPath: path.join(PUBLIC_UPLOAD_DIR, `${uploadId}.json`),
	};
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ uploadId: string }> },
) {
	const { uploadId } = await params;
	const { metadataPath } = getUploadPaths(uploadId);

	try {
		const metadataRaw = await fs.readFile(metadataPath, "utf-8");
		const metadata = JSON.parse(metadataRaw) as {
			token: string;
			filePath: string;
			contentType: string;
			fileName: string;
		};

		const requestUrl = new URL(_request.url);
		const token = requestUrl.searchParams.get("token");
		if (!token || token !== metadata.token) {
			return new NextResponse("Unauthorized upload token", { status: 401 });
		}

		const fileBuffer = await fs.readFile(metadata.filePath);
		return new NextResponse(new Uint8Array(fileBuffer), {
			status: 200,
			headers: {
				"Content-Type": metadata.contentType || "application/octet-stream",
				"Content-Disposition": `inline; filename="${metadata.fileName}"`,
				"Cache-Control": "private, no-store",
			},
		});
	} catch {
		return new NextResponse("Upload not found", { status: 404 });
	}
}
