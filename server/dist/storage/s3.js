import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CreateBucketCommand, } from '@aws-sdk/client-s3';
export class S3Adapter {
    client;
    bucket;
    constructor() {
        this.bucket = process.env.AWS_BUCKET || 'labrepo-storage';
        const endpoint = process.env.AWS_ENDPOINT;
        const region = process.env.AWS_REGION || 'us-east-1';
        // Check if it's likely MinIO or similar custom endpoint
        const forcePathStyle = endpoint && !endpoint.includes('amazonaws.com');
        this.client = new S3Client({
            region,
            endpoint,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY || 'minioadmin',
                secretAccessKey: process.env.AWS_SECRET_KEY || 'minioadmin',
            },
            forcePathStyle: !!forcePathStyle,
        });
    }
    async initBucket() {
        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '' })).catch(() => { });
            // In S3, HeadObject on empty key usually fails, we can just try CreateBucket directly and catch if it exists
        }
        catch {
            // Ignored
        }
        try {
            await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            console.log(`[storage] Bucket "${this.bucket}" created.`);
        }
        catch (err) {
            if (err.name === 'BucketAlreadyExists' || err.name === 'BucketAlreadyOwnedByYou') {
                // Bucket exists, fine.
            }
            else {
                console.error(`[storage] Error ensuring bucket "${this.bucket}":`, err);
                throw err;
            }
        }
    }
    async upload(key, data, contentType) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
        }));
    }
    async download(key) {
        const result = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
        if (!result.Body) {
            throw new Error('Empty response body');
        }
        // Convert stream to buffer
        const stream = result.Body;
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
        const data = Buffer.concat(chunks);
        return {
            data,
            contentType: result.ContentType || 'application/octet-stream',
        };
    }
    async delete(key) {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
    }
    async exists(key) {
        try {
            await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            return true;
        }
        catch (err) {
            if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw err;
        }
    }
    async list(prefix) {
        const keys = [];
        let continuationToken;
        do {
            const response = await this.client.send(new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
            if (response.Contents) {
                for (const item of response.Contents) {
                    if (item.Key)
                        keys.push(item.Key);
                }
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        return keys;
    }
}
