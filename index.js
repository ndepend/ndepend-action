const core = require('@actions/core');
const { Octokit } = require("@octokit/action");
const tc = require('@actions/tool-cache');
const exec = require('@actions/exec');
const {DefaultArtifactClient} = require('@actions/artifact')
const artifact = new DefaultArtifactClient();
const github = require('@actions/github');
const io = require('@actions/io');
const crypto = require('crypto');
const NDependAnalyzerHash="0261c493c1df2789c402cb85c3fb81877acd3e2943136f819862ac540a39501e"
fs = require('fs');
path = require('path');


const artifactFiles=[];
var artifactsRoot="";
const trendFiles=[];
const solutions=[];
function calculateSHA(input, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(input).digest('hex');
}

function populateArtifacts(dir,basedir) {
  fs.readdirSync(dir).forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
     // if(path.relative( basedir, fullPath ).indexOf("_")>0 || path.relative( basedir, fullPath ).indexOf("NDependReportFiles")>=0 || fullPath.indexOf("/NDependReportFiles/src")>=0  )
          populateArtifacts(fullPath,basedir);
     } else {
      //if( dir!=basedir  && (path.relative( basedir, fullPath ).indexOf("_")>0 || fullPath.indexOf("/NDependReportFiles/src")>=0))
      if(dir!=basedir || fullPath.indexOf("NDependReport.html")>=0)
      {
         artifactFiles.push(fullPath);
      }
     }
    
  });
}
function populateTrends(dir) {
  fs.readdirSync(dir).forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      if(fullPath.indexOf("TrendMetrics")>0)
          populateTrends(fullPath);
     } else {
      if(fullPath.indexOf("TrendMetrics")>0)
         trendFiles.push(fullPath);
     }
    
  });
}

function populateSolutions(dir) {
  fs.readdirSync(dir).forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
       
      populateSolutions(fullPath);
     } else {
      if (fullPath.endsWith(".sln")) {
        solutions.push(fullPath);
       }
      
     }  
  });
}
var ndependResultFile="";
function getNDependResult(ndependFolder) {


  if (!fs.existsSync(ndependFolder)) {
      
      return ;
  }
  core.info(ndependFolder);
  var files = fs.readdirSync(ndependFolder);
  for (var i = 0; i < files.length; i++) {
      var filename = path.join(ndependFolder, files[i]);
      
      
      var stat = fs.lstatSync(filename);
      if (stat.isDirectory()) {
        if(path.basename(filename)!="Baseline")
          getNDependResult(filename);
      } else if (filename.endsWith(".ndar")) {
         core.info(filename);
         ndependResultFile= filename;
         return;
      };
  };

}
function _getTempDirectory() {
  const tempDirectory = process.env['RUNNER_TEMP'] ;
  return tempDirectory;
}
async function checkIfNDependExists(owner,repo,runid,octokit,NDependBaseline,baseLineDir)
{
  const artifacts  = await octokit.request("Get /repos/{owner}/{repo}/actions/runs/{runid}/artifacts", {
    owner,
    repo,
    runid
  });
  for (const artifactKey in artifacts.data.artifacts) {
    const artifact=artifacts.data.artifacts[artifactKey];
    if(artifact.name=="ndepend" && !artifact.expired)
    {
      
      var artifactid=artifact.id;
      core.info("artifact found:"+artifactid);

      response  = await octokit.request("Get /repos/{owner}/{repo}/actions/artifacts/{artifactid}/zip", {
        owner,
        repo,
        artifactid
      });
      
      fs.writeFileSync(NDependBaseline, Buffer.from(response.data),  "binary",function(err) { });
      const baselineExtractedFolder = await tc.extractZip(NDependBaseline, baseLineDir);
      return true;
    }
  }
}
async function copyTrendFileIfExists(owner,repo,runid,octokit,trendsDir)
{
  const NDependTrendsZip=_getTempDirectory()+"/trends"+runid+".zip";
  
  const artifacts  = await octokit.request("Get /repos/{owner}/{repo}/actions/runs/{runid}/artifacts", {
    owner,
    repo,
    runid
  });
  for (const artifactKey in artifacts.data.artifacts) {
    const artifact=artifacts.data.artifacts[artifactKey];
    if(artifact.name=="ndependtrend" && !artifact.expired)
    {
      
      var artifactid=artifact.id;
      //core.info("artifact found:"+artifactid);

      response  = await octokit.request("Get /repos/{owner}/{repo}/actions/artifacts/{artifactid}/zip", {
        owner,
        repo,
        artifactid
      });
      const NDependTrendsDir=  trendsDir+"/run"+runid;
      fs.writeFileSync(NDependTrendsZip, Buffer.from(response.data),  "binary",function(err) { });
          const baselineExtractedFolder = await tc.extractZip(NDependTrendsZip, NDependTrendsDir);
          return true;
    }
  }
}
function isGitHubRunId(str) {
  return /^\d{8,12}$/.test(str); // Accepts run IDs between 8 and 10 digits long
}
async function run() {
  try {
    
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    })
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const currentRunNumber=process.env.GITHUB_RUN_NUMBER;
    const currentRunID=process.env.GITHUB_RUN_ID;
    const workflowName=process.env.GITHUB_WORKFLOW;
    const workspace=process.env.GITHUB_WORKSPACE;
    const license=core.getInput('license');
    const baseline=core.getInput('baseline');
    const stopifQGfailed=core.getInput('stopIfQGFailed');
    const solution=core.getInput('solution');
    const configPath = core.getInput('customconfig');
    const coveragePath = core.getInput('coveragefolder');
    const retentionDaysStr = core.getInput('retention-days')
   
    var branch=process.env.GITHUB_REF;
     if(branch.lastIndexOf('/')>0)
          branch=branch.substring(branch.lastIndexOf('/')+1);
       
    if(branch=="")
        branch="main";

    let rooturl=process.env.GITHUB_SERVER_URL+"/"+process.env.GITHUB_REPOSITORY+"/blob/"+branch;

    if(license=='')
        core.setFailed("The ndepend license is not specified, Please ensure that the license input is present in your workflow.")

    if(license!='' && license.indexOf("<NDepend")<0)
        core.setFailed("The ndepend license is not valid, Please check your license data.")

    //get ndepend and extract it
    const ndependToolURL = await tc.downloadTool('https://www.codergears.com/protected/GitHubActionAnalyzer.zip');
    //fs.copyFileSync(ndependToolURL, _getTempDirectory()+"/NDependTask.zip",fs.constants.COPYFILE_FICLONE_FORCE);
    await io.cp(ndependToolURL, _getTempDirectory()+"/NDependTask.zip")
    const tooldata = fs.readFileSync(_getTempDirectory()+"/NDependTask.zip", 'utf8');

    const hash = calculateSHA(tooldata, 'sha256');
    core.info("Get NDepend Analyzer with the SHA:");
    core.info(hash);
    if(hash!=NDependAnalyzerHash)
    {
      core.setFailed("The NDepend Analyzer SHA does not match the latest tool hash. Please contact the NDepend support to have more details about the issue.")
    }
    const ndependExtractedFolder = await tc.extractZip(_getTempDirectory()+"/NDependTask.zip", _getTempDirectory()+'/NDepend');
    var NDependParser=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/GitHubActionAnalyzer.exe"
    const licenseFile=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/NDependGitHubActionProLicense.xml"
    const configFile=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/NDependConfig.ndproj"
    const baseLineDir=_getTempDirectory()+'/NDependBaseLine';
    const trendsDir=_getTempDirectory()+'/NDependTrends';
    
    const NDependOut=_getTempDirectory()+"/NDependOut";
    const NDependBaseline=_getTempDirectory()+"/baseline.zip";
    // const NDependTrendsZip=_getTempDirectory()+"/trends.zip";
    

    //add license file in ndepend install directory
    fs.mkdirSync(trendsDir);
    fs.mkdirSync(NDependOut);
    fs.writeFileSync(licenseFile, license);
    var baselineFound=false;
    var currentBranch=baseline.substring(0,baseline.lastIndexOf('_recent'));
    

    // Check if the input is a valid integer
    if(baseline!='')
      {
    if (isGitHubRunId(baseline)) {
      
      
      
      const runId = Number(baseline);
      
      try {
     const run  = await octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}", {
        owner,
        repo,
        run_id: runId,
        
      });
      
        
        baselineFound= await checkIfNDependExists(owner,repo,run.data.id,octokit,NDependBaseline,baseLineDir);
    }
        catch (error) {
          if (error.status === 404) {
            core.warning("run id :"+baseline+" not found.");
          } else {
            core.warning("No NDepend artifacts found for this run id :"+baseline);
          }
          
        }
      
    }
    else
    {
      const workflowsResponse=await octokit.request("Get /repos/{owner}/{repo}/actions/workflows", {
        owner,
        repo
        
      });
      core.info(JSON.stringify(workflowsResponse));
      const workflows = workflowsResponse.data.workflows;
     

      const currentWorkflow=workflows.find(w => w.name === workflowName);
      const workflow_id=currentWorkflow.id;
   
      core.info(`Current workflow name is: ${workflow_id}`);
      runs  = await octokit.request("Get /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs?status=completed&per_page=100&branch={branch}", {
        owner,
        repo,
        workflow_id,
        branch
        
      });
    for (const runkey in runs.data.workflow_runs) {
      const run=runs.data.workflow_runs[runkey];
      if(run.repository.name==repo )
      {
        const runid=run.id;
        if (run.head_branch==branch)
          {
             await copyTrendFileIfExists(owner,repo,runid,octokit,trendsDir);
          }
          
        if (baseline=='recent' && run.head_branch==branch)
        {
          baselineFound= await checkIfNDependExists(owner,repo,runid,octokit,NDependBaseline,baseLineDir);
        }
        else if(baseline.lastIndexOf('_recent')>0)
        {
          if(currentBranch==run.head_branch)
              baselineFound= await checkIfNDependExists(owner,repo,runid,octokit,NDependBaseline,baseLineDir);
        }
        else if(run.run_number.toString()==baseline)
        {
          
          baselineFound= await checkIfNDependExists(owner,repo,runid,octokit,NDependBaseline,baseLineDir);
        } 
        if(baselineFound)
        {
          core.info("Baseline to compare with has the run number:"+run.run_number)
          break;
        }
      }
    }
  }
    if(baseline!=''  && !baselineFound)
    {
        if(baseline.indexOf("recent")<0 && isNaN(baseline))
            core.warning("The baseline value "+baseline+ " is not valid. Valid values are recent , branch_recent, specific run number");
        else
            core.warning("No baseline to compare found for :"+baseline);
        
      
    }
  }
    var args=['/sourceDirectory',workspace,'/outputDirectory',NDependOut,'/trendsDirectory',trendsDir,'/githubRootUrl',rooturl,'/account',owner,'/identifier',repo,'/buildId',currentRunNumber+" Id "+currentRunID];

    var configfilePath=workspace+"/"+configPath;
      if (!fs.existsSync(configfilePath)) {
          core.warning("The NDepend custom config file "+configPath+" is not found, a default config file will be used instead.");
        
      }

    if(configPath!="" && fs.existsSync(configfilePath))
    {
      args.push("/ndependProject");
      args.push(workspace+"/"+configPath);
      
    }
    else
    {
      populateSolutions(workspace);
      if(solutions.length==1)
      {
          args.push("/solutionPath");
          args.push(solutions[0]);
      }
      else if(solutions.length > 1)
      {
        if(solution!='')
        {
          args.push("/solutionPath");
          args.push(workspace+"/"+solution);
      
        }
        else
          core.setFailed("More than one VS solution is found in this repository, please specify which one you want to parse from the action inputs")
      }
      else if(solutions.length ==0 )
      {
        core.setFailed("No VS solution is found in this repository")
      }
    }
    getNDependResult(baseLineDir);
    if(baselineFound && ndependResultFile!=""  && fs.existsSync(ndependResultFile))
    {
      args.push("/oldndependProject");
      args.push(ndependResultFile);
    }
    if(coveragePath!='')
      {
        args.push("/coverageDir");
        args.push(coveragePath);
      }
    if(stopifQGfailed=='true')
      args.push("/stopBuild");
    var ret=0;
    try{
      var isLinux = process.platform === "linux";
      if(isLinux)
      {
        
        var NDependLinuxParser=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/net6.0/GitHubActionAnalyzer.MultiOS.dll";
        args.unshift(NDependLinuxParser);
        ret=await exec.exec("dotnet", args);
      }
      else
        ret=await exec.exec(NDependParser, args);

    }
    catch(error)
    {

    }

    const artifactClient = new DefaultArtifactClient();
    const artifactName = 'ndepend';

    var files=[];
    const rootDirectory = NDependOut;
    populateArtifacts(NDependOut,NDependOut);
    populateTrends(NDependOut);

    const options = {
        continueOnError: true
    }
    if (retentionDaysStr!='') {
      var retention = parseInt(retentionDaysStr)
      if (isNaN(retention)) {
        core.setFailed('Invalid retention-days')
      }
      else
      {
        options.retentionDays=retention;
      }
  }
   
    if ( fs.existsSync(NDependOut+"/project.ndproj") ) 
    {
        
      
        artifactFiles.push(NDependOut+"/project.ndproj");
    }

    const uploadResult = await artifactClient.uploadArtifact(artifactName, artifactFiles, NDependOut, options);

    if(trendFiles.length>0)
      await artifactClient.uploadArtifact("ndependtrend", trendFiles, NDependOut+"/TrendMetrics", options)


      const context = github.context;
      if (context.payload.pull_request != null) {
        const pull_request_number = context.payload.pull_request.number;

      
      if(fs.existsSync(NDependOut+"/comment.txt"))
      {
          var message = fs.readFileSync(NDependOut+"/comment.txt").toString();
          message=message+'\nTo have more details about the analysis you can Download the detailled report here ("https://github.com/'+owner+'/'+repo+'/actions/runs/'+currentRunID+'#artifacts")';
        
        
          const new_comment = octokit.issues.createComment({
              owner,repo,
              issue_number: pull_request_number,
              body: message
            });

       }
      }
      if(fs.existsSync(NDependOut+"/comment.txt"))
      {
        var message = fs.readFileSync(NDependOut+"/comment.txt").toString();
        //core.exportVariable("GITHUB_STEP_SUMMARY",NDependOut+"/comment.txt")
        core.summary.addRaw(message).write() ;

        if(message.indexOf("at least one Quality Gate failed")>0 && stopifQGfailed=='true')
          core.setFailed("The NDepend action failed the build because at least one Quality Gate failed and stopIfQGFailed is set to true  in the action options.");

      }

     
      
      
      } catch (error) {
        core.setFailed(error.message);
      }
}

run();