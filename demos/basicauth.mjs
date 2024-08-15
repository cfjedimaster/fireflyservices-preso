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

let access_token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('access_token', access_token);
