const platformClient = require('purecloud-platform-client-v2');
const { SecretsManagerClient, GetSecretValueCommand} = require("@aws-sdk/client-secrets-manager");
const {S3Client, PutObjectCommand} = require("@aws-sdk/client-s3");
const axios = require('axios');

const secretArn = process.env.SECRET_ARN;
const s3Bucket = process.env.S3_BUCKET;
const genesysCloudRegion = process.env.GENESYS_CLOUD_REGION;
const AWSCloudRegion = process.env.AWS_CLOUD_REGION;
const pageSize = (process.env.PAGE_SIZE && process.env.PAGE_SIZE >0)?process.env.PAGE_SIZE:10;
const deleteAfterUpload = process.env.DELETE_AFTER_UPLOAD;
const markReadAfterUpload = process.env.MARK_READ_AFTER_UPLOAD;
const disconnectCallback = process.env.DISCONNECT_CALLBACK;
const secretManagerClient = new SecretsManagerClient({region: AWSCloudRegion});
const s3Client = new S3Client({region: AWSCloudRegion});

exports.handler = async (event) => {
    console.log(`Incoming event: ${JSON.stringify(event)}`);
    const conversationId = event.detail.eventBody.conversationId;
    //keep in mind the queueId is part of the event.  If you only want to process certain queues, filter it in the EventBridge rule.
    const vmQueueId = event.detail.eventBody.queueId;
    await setupGcClient();
    const vmAPI = new platformClient.VoicemailApi();
    const conversationAPI = new platformClient.ConversationsApi();
    try {
        if(disconnectCallback === "true") {
            //disconnect callback so that we are not trying to get this vm routed to an agent.  This is desirable in some cases
            console.log('disconnecting conversation');
            await conversationAPI.patchConversationsCallback(conversationId, {state: "disconnected", participants: [{callbacks: [{state: "disconnected"}]}]});
        }
        let count = 1
        let vmEntities = [];
        let vmList;
        do {
             vmList = await vmAPI.getVoicemailQueueMessages(vmQueueId, {pageNumber: count++, pageSize: pageSize});
             vmEntities = vmEntities.concat(vmList.entities);
        } while(vmList.nextUri);
        const filteredVmList = vmEntities.filter(vm => vm.conversation.id === conversationId);
        if(!Array.isArray(filteredVmList) || !filteredVmList.length){
            //it may take the voicemail a few minutes to be available from the time the end event is sent. We will fail if
            //if we don't find it and then let lambda do some retries.  We are using the default Lambda backoff strategy
            //for retries.  For production this would probably need to be managed in a more sophisticated way.
            throw new Error(`No voicemail match was found for conversation ${conversationId}. Lambda will retry for us.`);
        }

        for (const vm of filteredVmList) {
            //TODO: possibly let the file format be specified
            const vmMedia = await vmAPI.getVoicemailMessageMedia(vm.id);
            const s3FileName = vm.id + ".webm";
            await uploadToS3(vmMedia.mediaFileUri, s3FileName);
            if(markReadAfterUpload === "true"){
                //mark vm read after upload to S3
                await vmAPI.patchVoicemailMessage(vm.id,{read: true});
            }
            if(deleteAfterUpload === "true"){
                //keep vm cleaned up if desired
                await vmAPI.deleteVoicemailMessage(vm.id);
            }

        }

    } catch (err) {
        handleError(err);
    }
};
async function setupGcClient(){
    const pendingSecret = await getSecret(secretArn);
    const secretValue = JSON.parse(pendingSecret.SecretString);

    //Create the Genesys Cloud client
    const gcClient = platformClient.ApiClient.instance;
    gcClient.setEnvironment(genesysCloudRegion);
    gcClient.setAccessToken(secretValue.accessToken);
}
async function uploadToS3(mediaFileUri, vmKey) {
    const options = {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/octet-stream'},
        responseType: 'arraybuffer'
    };
    const response = await axios.get(mediaFileUri, options);
    const uploadCommand = new PutObjectCommand({
        Bucket: s3Bucket,
        Key: vmKey,
        Body: response.data
    });
    console.log(`writing file: ${vmKey} to s3 in bucket: ${s3Bucket}`)
    await s3Client.send(uploadCommand);
    console.log(`finished writing file: ${vmKey} to s3 in bucket: ${s3Bucket}`)
}

async function getSecret(arn) {
    let secretVal = "not found";
    try {
        const getSecretValCommand = new GetSecretValueCommand({SecretId: arn, VersionStage: "AWSCURRENT"});
        secretVal = await secretManagerClient.send(getSecretValCommand);
    } catch (err) {
        handleError(err);
    }
    return secretVal;
}
function handleError(err) {
    console.error(err);
    throw err;
}
