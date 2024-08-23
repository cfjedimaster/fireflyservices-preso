import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import slugify from '@sindresorhus/slugify';

import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from "@azure/storage-blob";

// Credentials for Azure
const AZURE_ACCOUNTNAME = process.env.AZURE_ACCOUNTNAME;
const AZURE_KEY = process.env.AZURE_KEY;
const AZURE_CONTAINERNAME = process.env.AZURE_CONTAINERNAME;
const AZURE_CONNECTIONSTRING = process.env.AZURE_CONNECTIONSTRING;

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTIONSTRING);
const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINERNAME);

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

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

	let data = await resp.json();
	return data.access_token;
}

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

async function applyEdits(psd, text, outputs, id, token) {

	let data = {
		"inputs": [{
			"href": psd,
			"storage": "azure"
  		}],
		"options": {
			"layers":[]
		},
		"outputs": []
	};

	for(let output of outputs) {
		/*
		Each output is a size key and url. We use this to specify the edit to the text layer AND an output

		First, the text layer
		*/
		let [width, height] = output.size.split('x');
		data.options.layers.push({
			"name":`${width}x${height}-text`,
			"edit":{},
			"text": {
				"content": text
			}
		});

		// Then an output
		data.outputs.push({
			"href":output.url,
			"storage":"azure",
			"type":"image/jpeg",
			"trimToCanvas":true, 
			"layers":[
				{"name":`${width}x${height}`}
			]
		});
	}

	let resp = await fetch('https://image.adobe.io/pie/psdService/documentOperations', {
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
		if(data.outputs && data.outputs[0] && data.outputs[0].status) status = data.outputs[0].status;
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	return status;

}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

// PSD already online, so get a readable link to it
let psdTemplate = await getSignedDownloadUrl('template.psd', AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);
console.log('Generated a readable URL for your PSD template.');

let taglines = fs.readFileSync('./taglines.txt','utf8').trim().split('\n');

let sizes = ['1024x1408','1408x1024','1792x1024','1024x1024'];

for(let tagline of taglines) {
	console.log(`Doing tagline ${tagline}`);
	/*
	We need file names for our four outputs, and writable links
	*/
	let outputURLs = [];
	let downloadURLs = [];

	for(let size of sizes) {
		let [width,height] = size.split('x');
		let filename = `output/${slugify(tagline)}-${width}-${height}.jpg`;
		outputURLs.push(
			{
				size, 
				url: await getSignedUploadUrl(filename, containerClient, AZURE_CONTAINERNAME)
			});

		downloadURLs.push({
			name: filename,
			url:await getSignedDownloadUrl(filename, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME)
		});
	}

	/*
	So at this point, we have a tagline, we have writable urls for the four sizes, time to call the API
	*/
	let job = await applyEdits(psdTemplate, tagline, outputURLs, CLIENT_ID, token);
	await pollJob(job['_links'].self.href, CLIENT_ID, token);

	for(let download of downloadURLs) {
		await downloadFile(download.url, download.name);
		console.log(`Saved ${download.name}`);
	}

}