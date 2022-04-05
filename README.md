# MoveVoicemailToS3

## Motivation
Occasionally we run into situations where an oauth client needs a user context in order to function correctly.  In such
cases, a [Client Credential Oauth Grant](https://developer.genesys.cloud/authorization/platform-auth/use-client-credentials) 
won't work as it doesn't contain a user context.  However, that is the goto for developing server based or "unattended" 
processes that don't require user interaction.  At times these unattended processes need access to resources that 
require a user context. 

In this blueprint we are going to demonstrate how you can leverage an 
[Authorization Code Oauth Grant](https://developer.genesys.cloud/authorization/platform-auth/use-authorization-code)
to access API resources that require a user context in an unattended service.  Full disclosure, this is much more complicated 
than a Client Credential Grant as the access tokens need to be rotated on a regular basis.  Also, it is HIGHLY recommended 
that you don't use an end user for your grant.  If you do, and that end user is terminated or changes positions in 
someway, you are likely to want to either delete the account or change permissions which could break your backend 
process.  It is recommended that you use a "Service account".  There is no formal representation of a "Service account" 
in Genesys today, so we will need to use a full user account, but it is a user account that will not be used by a person 
for their work.  It will exist solely to provide access to the backend services.

## Overview
Accessing voicemail recordings API endpoints requires a user context.  We will demonstrate this functionality by moving 
newly created voicemails from Genesys to AWS S3.  While this is a simple use case, the principles here are transferable 
to other APIs that require a user context.  Do note, that without maintaining a per-user Authorization Code Grant Oauth 
Client, you will not be able to access direct dialed voicemails.  This example will only be dealing with queue based 
voicemails but could be extended to group based voice mails as well with some modifications.

If you need a process to move direct dialed voicemails, it is recommended that you include that in another process that 
your agent must interact with and ideally already log into Genesys with.  This becomes an "attended" process and is a 
more typical approach for a process that uses an Authorization Code Grant.

### Genesys Cloud Token Refresh
![Genesys Cloud Token Refresh](./documentation/Refresh%20Token.png)

### Genesys Cloud Voicemail Download
![Genesys Cloud Download Voicemail](./documentation/Download%20Voicemail.png)

As you can see we are going to leverage 2 lambdas.  The RefreshAuthToken Lambda will be responsible for rotating the 
secret and will be triggered by AWS Secrets manager, and it's rotation schedule. The MoveVoicemailToS3 will be 
responsible for downloading the voicemail and uploading it to your S3 bucket in your AWS account.  From there, you can
take whatever action you need on the voicemail.  The MoveVoicemailToS3 lambda will be triggered by the
[VoicemailEndEvent](https://developer.genesys.cloud/analyticsdatamanagement/analytics/detail/analytics-detail-events#voicemailendevent)
that will be sent over the AWS EventBridge.

### Additional Resources
* [AWS Lambda](https://aws.amazon.com/lambda/)
* [AWS EventBridge](https://aws.amazon.com/eventbridge/)
* [Genesys Cloud Event Bridge Overview](https://developer.genesys.cloud/notificationsalerts/notifications/event-bridge)
* [Genesys Oauth Overview](https://developer.genesys.cloud/authorization/platform-auth/)
* [Authorization Code Oauth Grant](https://developer.genesys.cloud/authorization/platform-auth/use-authorization-code)

### Prerequisites
* Install NodeJS on your local machine.  Download and installation instructions are [here](https://nodejs.org/en/download/)
* Set up a Genesys Cloud queue and allow Voicemails to be left on it.  While there are many options, you can do this easily  
  in Architect. https://help.mypurecloud.com/articles/manage-acd-voicemail-recordings/ 
## Genesys Cloud account setup
As stated above we will want to set up another a separate System Account to manage the voice mail downloads.  
* Create a role that will allow you to fetch the user details and the voicemails for the system user with the following 
permissions:
  * Analytics > User Detail > View
  * Voicemail > ACD voicemail > View
* Because you will also need to set up an oauth client for this user you can temporarily add the following permissions 
to that role or create a new role for these and remove that role after you get the Oauth client created:
  * General > Admin
  * Oauth > All Permissions
* Create a new "System" user with the role(s) you just created
* Go to the Admin menu and create an Oauth Client
  * Give it a name
  * Specify 86400 Token duration.  This is a full day and the minimum of what you want so things don't expire.   
  * Select "Code Authorization"
  * In the "Authorized redirect URIs" add https://www.getpostman.com/oauth2/callback if you want to use postman to 
create the credentials.  Feel free to do your own here if you know how to do this already.  As long as we end up with
an access token and a refresh token then we are good.
  * In the scope field specify "voicemail"
  * Click save.  This should give you the Client Id and the Client Secret.  Note these values as you will need them to 
fetch the access token and the refresh token 
* You can now remove the role or permissions from the role that give you access to the Admin menu and create Oauth clients.

## Get the access token and the refresh token
You are welcome to do this in whatever way you wish but I will quickly tell you how to do it with Postman.
* Open Postman
* Open a collection and click on the Authorization tab.
  * Grant Type: Authorization Code
  * Callback URL: https://www.getpostman.com/oauth2/callback
  * Auth URL: https://login.mypurecloud.com/authorize
    * You will need to change "mypurecloud" to match your region
  * Access Token URL: https://login.mypurecloud.com/oauth/token
    * You will need to change "mypurecloud" to match your region
  * Client ID: The Client Id you got from Genesys Cloud
  * Client Secret: The Client Secret you got from Genesys Cloud
  * Client Authentication: Send as Basic Auth header
  * Click "Get New Access Token"
  * Login using the user credentials for the Genesys Cloud Login for the System user
  * Once that process is done you should see a pop up screen called "Manage Access Tokens".
    * Note the "Access Token" and the "refresh_token".  You will need these values to set up the secret in AWS Secrets
manager

## Secrets Manager Setup
First follow the steps to set up the Secret Rotation Lambda found here: [refreshAuthTokenLambda](./refreshAuthTokenLambda/README.md)
Once you are done setting the Lambda up you can now set up the secret in Secrets manager.
* In your AWS Account you will need to go to AWS Secrets Manager and click "Store a new secret"
#### Step 1
  * Secret Type: "Other type of secret"
    * In the Key/Value pairs add the following:
      * clientId: GC Client ID
      * clientSecret: GC Client Secret
      * accessToken: Access Token from Postman
      * refreshToken: refresh_token from Postman
  * You are welcome to specify an Encryption key, but we do not take that into account in this blueprint and minor 
  changes will be needed in the Lambdas to fetch the secret and make sense of the access token.
  * Click next.
#### Step 2
  * Name your Secret
  * Fill in other details as you need but nothing else is required on this step for this blueprint
  * Click Next
#### Step 3
  * Enable "Automatic Rotation"
  * Select "Schedule expression builder"
  * Time Unit: Days
  * 1 Days
  * No Window Duration is required
  * You can select the "Rotate immediately when the secret is stored. The next rotation will begin on your schedule."
    * This will cause the secret to be rotated once you finish creating the secret.  This is a good test but you can do
easily manually once the secret is created as well.
  * Rotation function: Select the Lambda you created in the refreshAuthTokenLambda instructions above
  * Click Next
#### Step 4
  * Review and click Store

## Set up the Lambda to upload your voicemails to S3
At this point you have set up your secret in Secrets Manager.  The access_token should be refreshed daily.  Now we can
look at setting up the process to use the access_token!  Please refer to the 
[moveVoicemailToS3Lambda README](./moveVoicemailToS3Lambda/README.md) for details.

## Conclusion
We have set up a secret to be rotated by Secrets Manager and an EventBridge integration that will trigger a Lambda
to download the accompanying queue based voicemail from Genesys Cloud and then upload it to an S3 bucket.   
