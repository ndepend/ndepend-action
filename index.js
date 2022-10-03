const core = require('@actions/core');
const { Octokit } = require("@octokit/action");
const tc = require('@actions/tool-cache');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');

fs = require('fs');
path = require('path');
const artifactFiles=[];
var artifactsRoot="";
const trendFiles=[];
const solutions=[];

function populateArtifacts(dir,basedir) {
  fs.readdirSync(dir).forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      if(path.relative( basedir, fullPath ).indexOf("_")>0  )
          populateArtifacts(fullPath,basedir);
     } else {
      if( (dir!=basedir  && path.relative( basedir, fullPath ).indexOf("_")>0) )
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
    if(artifact.name=="ndepend")
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

async function run() {
  try {
    
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    })
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const currentRunNumber=process.env.GITHUB_RUN_NUMBER;
const currentRunID=process.env.GITHUB_RUN_ID;

const workspace=process.env.GITHUB_WORKSPACE;
const license=core.getInput('license');
const baseline=core.getInput('baseline');
const stopifQGfailed=core.getInput('stopIfQGFailed');
const solution=core.getInput('solution');
const configPath = core.getInput('customconfig');
const coveragePath = core.getInput('coveragefolder');
var branch=process.env.GITHUB_HEAD_REF;
if(branch=="")
    branch="main";

let rooturl=process.env.GITHUB_SERVER_URL+"/"+process.env.GITHUB_REPOSITORY+"/blob/"+branch;

if(license=='')
    core.setFailed("The ndepend license is not specified, Please ensure that the license input is present in your workflow.")

if(license!='' && license.indexOf("<NDepend")<0)
    core.setFailed("The ndepend license is not valid, Please check your license data.")

//get ndepend and extract it
const ndependToolURL = await tc.downloadTool('https://www.codergears.com/protected/GitHubActionAnalyzer.zip');
const ndependExtractedFolder = await tc.extractZip(ndependToolURL, _getTempDirectory()+'/NDepend');
var NDependParser=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/GitHubActionAnalyzer.exe"
const licenseFile=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/NDependGitHubActionProLicense.xml"
const configFile=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/NDependConfig.ndproj"
const baseLineDir=_getTempDirectory()+'/NDependBaseLine';
const NDependOut=_getTempDirectory()+"/NDependOut";
const NDependBaseline=_getTempDirectory()+"/baseline.zip";

//add license file in ndepend install directory
fs.mkdirSync(NDependOut);
fs.writeFileSync(licenseFile, license);
 runs  = await octokit.request("Get /repos/{owner}/{repo}/actions/runs", {
  owner,
  repo
  
});
var baselineFound=false;
for (const runkey in runs.data.workflow_runs) {
  const run=runs.data.workflow_runs[runkey];
  if(run.repository.name==repo )
  {
    const runid=run.id;
    if (baseline=='recent' && run.head_branch==branch)
    {
      //check if ndepend artifact exists
      baselineFound= await checkIfNDependExists(owner,repo,runid,octokit,NDependBaseline,baseLineDir);
    }
    else if(baseline.lastIndexOf('_recent')>0)
    {
       var currentBranch=baseline.substring(0,baseline.lastIndexOf('_recent'));
       if(currentBranch==branch)
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
};
if(baseline!=''  && !baselineFound)
{
    if(baseline.indexOf("recent")<0 && isNaN(baseline))
        core.warning("The baseline value "+baseline+ " is not valid. Valid values are recent , branch_recent, specific run number");
    else
        core.warning("No baseline to compare found for :"+baseline);
    
  
}
var args=['/sourceDirectory',workspace,'/outputDirectory',NDependOut,'/githubRootUrl',rooturl,'/account',owner,'/identifier',repo,'/buildId',currentRunNumber+" Id "+currentRunID];

var configfilePath=workspace+"/"+configPath;
  if (!fs.existsSync(configfilePath)) {
      core.warning("The NDepend custom config file "+configPath+" is not found, a default config file will be used instead.");
    
  }

if(configPath!="" && fs.existsSync(configfilePath))
{
  //test in configpath exists else show message
  
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

var isLinux = process.platform === "linux";
if(isLinux)
{
   
  var NDependLinuxParser=_getTempDirectory()+"/NDepend/GitHubActionAnalyzer/net5.0/GitHubActionAnalyzer.MultiOS.dll";
  args.unshift(NDependLinuxParser);
  ret=await exec.exec("dotnet", args);
}
else
  ret=await exec.exec(NDependParser, args);



const artifactClient = artifact.create()
const artifactName = 'ndepend';

var files=[];
const rootDirectory = NDependOut;
populateArtifacts(NDependOut,NDependOut);
populateTrends(NDependOut);


const options = {
    continueOnError: true
}
if(baselineFound && ndependResultFile!=""  && fs.existsSync(ndependResultFile))
{
    var baselineDir=NDependOut+"/Baseline";
    var baselinePath= baselineDir+"/"+path.basename(ndependResultFile);
    core.info(ndependResultFile);
    core.info(baselinePath);
    fs.mkdirSync(baselineDir);
    fs.copyFileSync(ndependResultFile, baselinePath);
  
    artifactFiles.push(baselinePath);
}

/*if (configPath!="" &&  fs.existsSync(configfilePath) && configfilePath.indexOf(".ndproj")>0) 
{
    fs.copyFileSync(configfilePath, NDependOut+"/project.ndproj");
  
    artifactFiles.push(NDependOut+"/project.ndproj");
}*/
if ( fs.existsSync(NDependOut+"/project.ndproj") ) 
{
    
  
    artifactFiles.push(NDependOut+"/project.ndproj");
}

const uploadResult = await artifactClient.uploadArtifact(artifactName, artifactFiles, NDependOut, options)
if(trendFiles.length>0)
   await artifactClient.uploadArtifact("ndependtrend", trendFiles, NDependOut+"/TrendMetrics", options)

if(ret<0 && stopifQGfailed=='true')
  core.setFailed("NDepend tool exit with error status.");

   
   
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
