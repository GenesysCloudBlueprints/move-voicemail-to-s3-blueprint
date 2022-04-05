echo 'Creating zip...'
zip -r ./Archive.zip index.js ./node_modules
echo 'Deploying lambda...'
# for an unkown reason the output of the aws cli is sent to a vi session which hung the script.  In order to avoid this,
# I have redirected the output to a file, cat the file so you can see it and then deleted the file.  If you figure out
# a better way, let me know!
aws lambda update-function-code --zip-file fileb://Archive.zip --function-name  refreshAuthToken > deploy.log
cat deploy.log
echo 'Cleaning up the files we created...'
rm deploy.log
rm Archive.zip
echo 'Deploy is finished!'
