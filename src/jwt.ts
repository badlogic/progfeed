import axios from "axios";
import { base58btc } from "multiformats/bases/base58";
import { Buffer } from "buffer";
import * as secp256k1 from "@noble/secp256k1";
import { createHash } from "crypto";
import { LRUCache } from "lru-cache";

interface JwtPayload {
	iss: string;
	aud: string;
	exp: number;
	iat: number;
	jti: string;
	lxm?: string;
}

interface PlcDocument {
	did: string;
	verificationMethods: {
		atproto: string;
		[key: string]: string;
	};
	rotationKeys: string[];
	alsoKnownAs: string[];
	services: {
		atproto_pds?: {
			type: string;
			endpoint: string;
		};
		[key: string]: any;
	};
}

export async function verifyToken(token: string, expectedAudience: string): Promise<JwtPayload> {
	// Remove 'Bearer ' prefix if present
	const jwt = token.replace("Bearer ", "");

	// Split the token
	const [headerB64, payloadB64, signatureB64] = jwt.split(".");

	// Decode header and payload
	const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
	const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

	// Basic validation
	if (!payload.iss || !payload.aud || !payload.exp || !payload.iat || !payload.jti) {
		throw new Error("Missing required JWT fields");
	}

	// Check algorithm
	if (header.alg !== "ES256K") {
		throw new Error(`Unsupported algorithm: ${header.alg}`);
	}

	// Check audience
	if (payload.aud !== expectedAudience) {
		throw new Error(`Invalid audience: expected ${expectedAudience}, got ${payload.aud}`);
	}

	// Check expiration
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp < now) {
		throw new Error("Token expired");
	}

	const isValid = async (publicKey: Uint8Array) => {
		// Create message hash
		const message = `${headerB64}.${payloadB64}`;
		const messageHash = createHash("sha256").update(message).digest();

		// Decode signature
		const signature = Buffer.from(signatureB64, "base64url");

		// Split signature into r and s components
		const r = signature.slice(0, 32);
		const s = signature.slice(32);

		return await secp256k1.verify(
			Buffer.concat([r, s]), // Signature
			messageHash, // Message hash
			publicKey // Public key
		);
	};

	// Get public key from cache
	let valid = false;
	if (plcCache.has(payload.iss)) {
		valid = await isValid(plcCache.get(payload.iss)!);
	}

	// If that didn't work, try to get a new key from PLC directory
	if (!valid) {
		const publicKey = await getPublicKeyFromPLC(payload.iss);
		valid = await isValid(publicKey);
	}

	if (!valid) {
		throw new Error("Invalid signature");
	}

	return payload;
}

const plcCache: LRUCache<string, Uint8Array> = new LRUCache({ max: 10000 });
async function getPublicKeyFromPLC(did: string): Promise<Uint8Array> {
	try {
		// Fetch PLC document
		const response = await axios.get(`https://plc.directory/${did}/data`);
		const plcDoc: PlcDocument = response.data;

		// Get the atproto verification key
		const atprotoKey = plcDoc.verificationMethods.atproto;
		if (!atprotoKey) {
			throw new Error("No atproto verification method found");
		}

		// Convert did:key to public key bytes
		const key = didKeyToPublicKeyBytes(atprotoKey);
		plcCache.set(did, key);
		return key;
	} catch (error) {
		throw new Error(`Failed to resolve DID: ${(error as any).message}`);
	}
}

function didKeyToPublicKeyBytes(didKey: string): Uint8Array {
	// Extract the key part from did:key format
	const parts = didKey.split(":");
	if (parts.length !== 3 || parts[0] !== "did" || parts[1] !== "key") {
		throw new Error("Invalid did:key format");
	}

	// Add 'z' prefix if not present
	const multibaseKey = parts[2].startsWith("z") ? parts[2] : `z${parts[2]}`;

	try {
		const bytes = base58btc.decode(multibaseKey);
		// Remove multicodec prefix (2 bytes)
		return bytes.slice(2);
	} catch (error) {
		throw new Error(`Failed to decode key: ${(error as any).message}`);
	}
}
