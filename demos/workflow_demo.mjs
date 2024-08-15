/*
I illustrate a simple workflow. 

* I use FF T2I to make an image.
* I download the result, upload it to S3
* I used PS API createRendition to make a thumbnail.
*/

import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;

const s3Client = new S3Client({ 
	region: 'us-east-1',
	credentials: {
		secretAccessKey: S3_SECRET_ACCESS_KEY, 
		accessKeyId: S3_ACCESS_KEY_ID
	}
});

const bucket = 'ffs-demos';

async function getSignedDownloadUrl(path) {
	let command = new GetObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function getSignedUploadUrl(path) {
	let command = new PutObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function getAccessToken(id, secret) {

	const params = new URLSearchParams();

	params.append('grant_type', 'client_credentials');
	params.append('client_id', id);
	params.append('client_secret', secret);
	params.append('scope', 'openid,AdobeID,firefly_enterprise,firefly_api,ff_apis');
	
	let resp = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', 
		{ 
			method: 'POST', 
			body: params
		}
	);

	return (await resp.json()).access_token;
}

async function textToImage(prompt, id, token) {

	let body = {
		prompt
	}

	let req = await fetch('https://firefly-api.adobe.io/v3/images/generate', {
		method:'POST',
		headers: {
			'X-Api-Key':id, 
			'Authorization':`Bearer ${token}`,
			'Content-Type':'application/json'
		}, 
		body: JSON.stringify(body)
	});

	return await req.json();
}

async function downloadFile(url, filePath) {
	let res = await fetch(url);
	const body = Readable.fromWeb(res.body);
	const download_write_stream = fs.createWriteStream(filePath);
	return await finished(body.pipe(download_write_stream));
}

// Currently assumes an image
async function uploadFile(url, filePath) {
	let size = fs.statSync(filePath).size;

	await fetch(url, {
		method:'PUT', 
		headers: {
			'Content-Type':'image/*',
			'Content-Length':size
		},
		body: fs.readFileSync(filePath)
	});

}

/*
I'm making a rendition job with hard coded width for my thumbnail.
*/
async function makeRenditionJob(input, output, id, token) {
	let data = {
		"inputs": [{
			"href": input,
			"storage": "external"
		}],
		"outputs": [{
			"href": output,
			"storage": "external",
			"type":"image/jpeg",
			"overwrite": true,
			"width":100
		}]
	};				

	let resp = await fetch('https://image.adobe.io/pie/psdService/renditionCreate', {
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id,
			'Content-Type':'application/json'
		}, 
		method:'POST',
		body:JSON.stringify(data)
	});

	return await resp.json();
}

// Lame function to add a delay to my polling calls
async function delay(x) {
	return new Promise(resolve => {
		setTimeout(() => resolve(), x);
	});
}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('Got the access token.');

let prompt = 'a cat dancing on a rainbow';
let result = await textToImage(prompt, CLIENT_ID, token);
console.log('Generated an image with Firefly');

await downloadFile(result.outputs[0].image.url, "./workflow.jpg");
console.log('Downloaded it locally.');

let uploadURL = await getSignedUploadUrl('workflowtemp.jpg');
await uploadFile(uploadURL, './workflow.jpg');
console.log('Uploaded it to cloud storage.');

let inputURL = await getSignedDownloadUrl('workflowtemp.jpg');
let thumbnailURL = await getSignedUploadUrl('workflowtemp_thumb.jpg');

let job = await makeRenditionJob(inputURL, thumbnailURL, CLIENT_ID, token);
let jobUrl = job._links.self.href;

let status = '';
while(status !== 'succeeded' && status !== 'failed') {

	let resp = await fetch(jobUrl, {
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': CLIENT_ID
		}
	});
	let data = await resp.json(); 

	status = data.outputs[0].status;
	console.log(`Current status: ${status}`);
	if(status !== 'succeeded' && status !== 'failed') await delay(1000);
}

console.log('Job is done (hopefully successfully)');

let resultURL = await getSignedDownloadUrl('workflowtemp_thumb.jpg');
await downloadFile(resultURL, './workflow_thumb.jpg');

console.log('Done, and result saved to workflow.jpg and workflow_thumb.jpg');

// Note - not done - cleanup of S3 temp files.
// Note - not handled - multi-threaded
