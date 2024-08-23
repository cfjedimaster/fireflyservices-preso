import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from "@azure/storage-blob";

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Credentials for Azure
const AZURE_ACCOUNTNAME = process.env.AZURE_ACCOUNTNAME;
const AZURE_KEY = process.env.AZURE_KEY;
const AZURE_CONTAINERNAME = process.env.AZURE_CONTAINERNAME;
const AZURE_CONNECTIONSTRING = process.env.AZURE_CONNECTIONSTRING;

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTIONSTRING);
const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINERNAME);

// Folder to scan
const folder = '../../../assets/removebg/';

function createSASReadString(key, accountName, containerName, duration=5) {
	
	let permissions = new BlobSASPermissions();
	permissions.read = true;

	let currentDateTime = new Date();
	let expiryDateTime = new Date(currentDateTime.setMinutes(currentDateTime.getMinutes()+duration));
	let blobSasModel = {
		containerName,
		permissions,
		expiresOn: expiryDateTime
	};

	let credential = new StorageSharedKeyCredential(accountName,key);
	return generateBlobSASQueryParameters(blobSasModel,credential);

}

function getSignedDownloadUrl(name, key, accountName, containerName) {
	let b = containerClient.getBlockBlobClient(name);
	return b.url + '?' + createSASReadString(key, accountName, containerName);
}

async function getSignedUploadUrl(name, client, containerName, duration=5) {
	let permissions = new BlobSASPermissions();
	permissions.write = true;

	let currentDateTime = new Date();
	let expiryDateTime = new Date(currentDateTime.setMinutes(currentDateTime.getMinutes()+duration));
	let blobSasModel = {
		containerName,
		permissions,
		expiresOn: expiryDateTime
	};

	let tempBlockBlobClient = client.getBlockBlobClient(name);
	return await tempBlockBlobClient.generateSasUrl(blobSasModel);
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
			'Content-Length':size,
			'x-ms-blob-type':'BlockBlob'
		},
		body: fs.readFileSync(filePath)
	});

}

async function getAccessToken(id, secret) {

	const params = new URLSearchParams();

	params.append('grant_type', 'client_credentials');
	params.append('client_id', id);
	params.append('client_secret', secret);
	params.append('scope', 'firefly_api,ff_apis,openid,AdobeID,session,additional_info,read_organizations');

	let resp = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', 
		{ 
			method: 'POST', 
			body: params
		}
	);

	return (await resp.json()).access_token;
}

async function removeBG(input, output, id, token) {

	let data = {
		"input": {
			"href": input,
			"storage": "azure"
  		},
		"output": {
		    "href": output,
		    "storage": "azure",
    		"overwrite": true
		}
	};

	let resp = await fetch('https://image.adobe.io/sensei/cutout', {
		method: 'POST', 
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id
		}, 
		body: JSON.stringify(data)
	});

	return await resp.json();

}

async function delay(x) {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve();
		}, x);
	});
}

async function pollJob(jobUrl, id, token) {
	let status = '';

	while(status !== 'succeeded' && status !== 'failed') {

		let resp = await fetch(jobUrl, {
			headers: {
				'Authorization':`Bearer ${token}`,
				'x-api-key': id
			}
		});

		let data = await resp.json();

		if(data.status) status = data.status;
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	return status;

}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('Got the access token.');

let files = fs.readdirSync(folder);

/*
For each file, we're going to upload to s3 bucket. We SHOULD look for name conflicts or use a UUID perhaps.
*/
for(let f of files) {
	console.log(`Working on ${f}`);
	// first generate an upload link
	let inputPath = `input/${f}`;
	let uploadUrl = await getSignedUploadUrl(inputPath, containerClient, AZURE_CONTAINERNAME);
	await uploadFile(uploadUrl, folder + f);
	console.log(`Uploaded ${f} to cloud storage.`);

	let inputUrl = await getSignedDownloadUrl(inputPath, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);

	let outputPath = `output/${f}`;
	let outputUrl = await getSignedUploadUrl(outputPath, containerClient, AZURE_CONTAINERNAME);

	let job = await removeBG(inputUrl, outputUrl, CLIENT_ID, token);
	let result = await pollJob(job['_links'].self.href, CLIENT_ID, token);

	let readableOutputUrl = await getSignedDownloadUrl(outputPath, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);

	await downloadFile(readableOutputUrl, `output/${f}_process.jpg`);
	console.log('Down removing background and saved result.');

}