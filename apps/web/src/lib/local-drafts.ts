import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TProjectMetadata } from "@/lib/project/types";

const OPENCUT_TICKS_PER_SECOND = 120_000;
const COVER_CANDIDATE_FILES = ["draft_cover.jpg", "draft_cover.jpeg", "draft_cover.png"];

type LegacyDraftMetaInfo = {
	draft_cover?: string;
	draft_fold_path?: string;
	draft_id?: string;
	draft_is_invisible?: boolean;
	draft_name?: string;
	tm_draft_create?: number | string;
	tm_draft_modified?: number | string;
	tm_duration?: number | string;
};

type LegacyDraftContent = {
	duration?: number | string;
};

export function getLocalDraftRoots(): string[] {
	const userProfile = process.env.USERPROFILE ?? os.homedir();
	return [
		path.join(userProfile, "gstechmediacut Drafts"),
		path.join(userProfile, "GSTECHMEDIACUT Drafts"),
		path.join(userProfile, "gstechmediacut"),
		path.join(userProfile, "GSTECHMEDIACUT"),
		path.join(userProfile, "GSMEDIACUT Drafts"),
		path.join(userProfile, "GSMEDIACUT"),
	];
}

function createExternalProjectId(folderPath: string): string {
	const hash = createHash("sha1").update(folderPath).digest("hex");
	return `external-draft:${hash}`;
}

function parseNumber(value: number | string | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return null;
}

function parseTimestamp(value: number | string | undefined, fallbackMs: number): Date {
	const parsed = parseNumber(value);
	if (parsed === null) {
		return new Date(fallbackMs);
	}

	// Legacy draft folders often store timestamps in microseconds.
	const milliseconds =
		parsed > 10_000_000_000_000 ? parsed / 1000 : parsed;

	return new Date(milliseconds);
}

function parseDurationTicks({
	metaDuration,
	contentDuration,
}: {
	metaDuration?: number | string;
	contentDuration?: number | string;
}): number {
	const rawDuration = parseNumber(metaDuration) ?? parseNumber(contentDuration) ?? 0;
	if (rawDuration <= 0) {
		return 0;
	}

	// Legacy draft folders often store duration in microseconds; convert to OpenCut ticks.
	return Math.max(
		0,
		Math.round((rawDuration / 1_000_000) * OPENCUT_TICKS_PER_SECOND),
	);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findDraftCoverPath({
	folderPath,
	metaInfo,
}: {
	folderPath: string;
	metaInfo: LegacyDraftMetaInfo | null;
}): Promise<string | null> {
	const candidates = [
		typeof metaInfo?.draft_cover === "string" && metaInfo.draft_cover.length > 0
			? path.join(folderPath, metaInfo.draft_cover)
			: null,
		...COVER_CANDIDATE_FILES.map((filename) => path.join(folderPath, filename)),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (await fileExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

export async function listLocalDraftProjects(): Promise<TProjectMetadata[]> {
	const projects: TProjectMetadata[] = [];
	const seenPaths = new Set<string>();

	for (const rootPath of getLocalDraftRoots()) {
		let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
		try {
			entries = (await fs.readdir(rootPath, {
				withFileTypes: true,
			})) as Array<{ name: string; isDirectory: () => boolean }>;
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) {
				continue;
			}

			const folderPath = path.join(rootPath, entry.name);
			if (seenPaths.has(folderPath)) {
				continue;
			}

			const metaInfoPath = path.join(folderPath, "draft_meta_info.json");
			if (!(await fileExists(metaInfoPath))) {
				continue;
			}

			const [stats, metaInfo, draftContent] = await Promise.all([
				fs.stat(folderPath),
				readJsonFile<LegacyDraftMetaInfo>(metaInfoPath),
				readJsonFile<LegacyDraftContent>(path.join(folderPath, "draft_content.json")),
			]);

			if (metaInfo?.draft_is_invisible) {
				continue;
			}

			const coverPath = await findDraftCoverPath({ folderPath, metaInfo });
			const thumbnail = coverPath
				? `/api/local-drafts/thumbnail?folderPath=${encodeURIComponent(folderPath)}`
				: undefined;

			projects.push({
				id: createExternalProjectId(folderPath),
				name:
					(typeof metaInfo?.draft_name === "string" && metaInfo.draft_name.trim()) ||
					entry.name,
				thumbnail,
				duration: parseDurationTicks({
					metaDuration: metaInfo?.tm_duration,
					contentDuration: draftContent?.duration,
				}),
				createdAt: parseTimestamp(metaInfo?.tm_draft_create, stats.birthtimeMs),
				updatedAt: parseTimestamp(metaInfo?.tm_draft_modified, stats.mtimeMs),
				source: "external-draft",
				externalPath: folderPath,
				isReadOnly: true,
			});

			seenPaths.add(folderPath);
		}
	}

	return projects;
}

export function isAllowedLocalDraftPath(folderPath: string): boolean {
	const normalizedPath = path.resolve(folderPath);
	return getLocalDraftRoots().some((rootPath) => {
		const normalizedRoot = path.resolve(rootPath);
		return (
			normalizedPath === normalizedRoot ||
			normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
		);
	});
}

export async function getLocalDraftCoverFilePath(
	folderPath: string,
): Promise<string | null> {
	if (!isAllowedLocalDraftPath(folderPath)) {
		return null;
	}

	const metaInfo = await readJsonFile<LegacyDraftMetaInfo>(
		path.join(folderPath, "draft_meta_info.json"),
	);
	return findDraftCoverPath({ folderPath, metaInfo });
}
