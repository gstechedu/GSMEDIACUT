import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { webEnv } from "@/lib/env/web";

function hasValue(value: string | undefined) {
	return typeof value === "string" && value.length > 0;
}

export function hasR2Config() {
	return (
		hasValue(webEnv.R2_ACCOUNT_ID) &&
		hasValue(webEnv.R2_ACCESS_KEY_ID) &&
		hasValue(webEnv.R2_SECRET_ACCESS_KEY) &&
		hasValue(webEnv.R2_BUCKET)
	);
}

function requireR2Env() {
	if (!hasR2Config()) {
		throw new Error(
			"Missing R2 configuration. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
		);
	}

	return {
		accountId: webEnv.R2_ACCOUNT_ID as string,
		accessKeyId: webEnv.R2_ACCESS_KEY_ID as string,
		secretAccessKey: webEnv.R2_SECRET_ACCESS_KEY as string,
		bucket: webEnv.R2_BUCKET as string,
	};
}

let cachedClient: S3Client | null = null;

function getR2Client() {
	if (cachedClient) {
		return cachedClient;
	}

	const env = requireR2Env();
	cachedClient = new S3Client({
		region: "auto",
		endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: env.accessKeyId,
			secretAccessKey: env.secretAccessKey,
		},
	});

	return cachedClient;
}

export async function uploadTempObject({
	key,
	body,
	contentType,
}: {
	key: string;
	body: Uint8Array;
	contentType: string;
}) {
	const env = requireR2Env();
	const client = getR2Client();

	await client.send(
		new PutObjectCommand({
			Bucket: env.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
}

export async function createSignedDownloadUrl({
	key,
	expiresInSeconds,
}: {
	key: string;
	expiresInSeconds: number;
}) {
	const env = requireR2Env();
	const client = getR2Client();

	return getSignedUrl(
		client,
		new GetObjectCommand({
			Bucket: env.bucket,
			Key: key,
		}),
		{ expiresIn: expiresInSeconds },
	);
}

export async function createSignedUploadUrl({
	key,
	contentType,
	expiresInSeconds,
}: {
	key: string;
	contentType: string;
	expiresInSeconds: number;
}) {
	const env = requireR2Env();
	const client = getR2Client();

	return getSignedUrl(
		client,
		new PutObjectCommand({
			Bucket: env.bucket,
			Key: key,
			ContentType: contentType,
		}),
		{ expiresIn: expiresInSeconds },
	);
}

export async function deleteObject({ key }: { key: string }) {
	const env = requireR2Env();
	const client = getR2Client();

	await client.send(
		new DeleteObjectCommand({
			Bucket: env.bucket,
			Key: key,
		}),
	);
}
