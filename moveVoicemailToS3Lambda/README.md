# MoveVoicemailToS3Lambda

This Lambda is triggered by the EventBridge VoicemailEndEvent sent from Genesys Cloud.  It will download the related
voicemail file and upload it to S3.

### Setup S3
* Go to S3
  * Click "Create Bucket"
  * Specify a name
  * The default settings are fine for our purposes.
  * Click "Create Bucket"
### Setup Lambda
* Go to AWS Lambda
* Click "Create Lambda"
    * Give it a name
    * Select Node.js 14.x in the Runtime
    * Leave the rest of the defaults
    * Click "Create function"
* Click the "Configuration" tab
    * On the "General configuration" tab set the timeout to 3 minute.  This is arbitrarily long, however some voicemails
can be rather large and require additional processing time.
    * Click the "Permissions" tab
        * Click on the execution role.  This will take you to the IAM page.
            * Click on the Policy.  This will take you to the page to manage the policy for this role. We are adding the
ability for the Lambda to be able to access the secret.  We will also allow the lambda to write to the S3 bucket.
                * You will want to edit the policy and add the following permissions:
                    * "secretsmanager:DescribeSecret"
                    * "secretsmanager:GetResourcePolicy"
                    * "secretsmanager:ListSecretVersionIds"
                    * "secretsmanager:GetSecretValue"
                    * "s3:PutObject"
                * Specify the ARN for your Secret or a pattern that will match your Secret's ARN.  Also, add the ARN 
pattern for your S3 bucket you created above.
                * You can and should leave the permission for CloudWatch.
                * Review the Policy and Save the changes
    * Click the "Environment Variables" tab and add the following variables:
      * Key|Value
      * AWS_CLOUD_REGION|<Region where your secret and S3 bucket are located>
      * GENESYS_CLOUD_REGION|<Genesys Cloud region where your org is running>
      * S3_BUCKET|<Name of your S3 bucket>
      * SECRET_ARN|<ARN of your Secret in Secrets Manager>
* Create the install package to upload to your Lambda function
    * Navigate to the folder that contains this README.md in a terminal window.  (This requires that NodeJS is installed
      locally as specified in the main [README](../README.md))
    * Run `npm install`
    * Add the index.js and the node_modules folder to a zip archive
* Click on the "Code" tab on the Lambda in the AWS console
    * Upload the zip file to the Lambda

#### EventBridge Setup
To invoke this Lambda we will leverage EventBridge to tell us when a Voicemail has ended for this queue.  The setup of
EventBridge is well beyond the scope of this document.  Please see the documentation for that here: 
[EventBridge Installation/Configuration](https://help.mypurecloud.com/articles/about-the-amazon-eventbridge-integration/)
* On the Genesys Cloud side you will need to specify the `v2.detail.events.conversation.{id}.voicemail.end` topic in the 
integration's configuration.
* On the AWS side you will need to set up a Rule on your Event Bus so that when an event comes in, this Lambda is 
invoked.  In order to accomplish that, you will want to specify an event patter like so on your rule.
  ```
    {
      "account": ["<your AWS account number>"],
      "detail-type": ["v2.detail.events.conversation.{id}.voicemail.end"],
      "detail.eventBody.queueId": ["<the Genesys Cloud QueueId that the voicemails will be left on."]
    } 
  ```
* Once the EventBridge is set up you are done with this Lambda setup.
