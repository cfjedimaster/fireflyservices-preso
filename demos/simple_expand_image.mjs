import fs from 'fs';

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

	return (await resp.json()).access_token;
}

async function uploadImage(filePath, fileType, id, token) {

	let stream = fs.createReadStream(filePath);
	let stats = fs.statSync(filePath);
	let fileSizeInBytes = stats.size;

	let upload = await fetch('https://firefly-api.adobe.io/v2/storage/image', {
		method:'POST', 
		headers: {
			'Authorization':`Bearer ${token}`, 
			'X-API-Key':id, 
			'Content-Type':fileType, 
			'Content-Length':fileSizeInBytes
		}, 
		duplex:'half', 
		body:stream
	});

	return await upload.json();
}

async function expandImage(source, id, token) {

	let body = {
		image: {
			source: {
				uploadId: source
			}
		},
		size: {
			width: 3999,
			height: 2048
		}
	}

	let req = await fetch('https://firefly-api.adobe.io/v3/images/expand', {
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

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

let imageAsset = await uploadImage('./bike.jpg', 'image/jpeg', CLIENT_ID, token);
console.log('Image result', JSON.stringify(imageAsset,null,'\t'));

let result = await expandImage(imageAsset.images[0].id, CLIENT_ID, token);

console.log(JSON.stringify(result,null,'\t'));
