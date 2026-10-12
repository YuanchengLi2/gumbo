using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

record Request(string Id,string Workspace,string Cwd,string Command,string CommandHash,string ReceiptPath,string[] ReadRoots,Dictionary<string,string> Environment,int TimeoutMs,string? Shell=null);
static class Program {
 static readonly JsonSerializerOptions Json=new(){PropertyNameCaseInsensitive=true,PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
 static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
 // One argument for CommandLineToArgvW and the C runtime: backslashes double only before a quote, quotes are escaped.
 static string Quote(string arg){var b=new StringBuilder("\"");int slashes=0;foreach(char c in arg){if(c=='\\'){slashes++;continue;}b.Append('\\',c=='"'?slashes*2+1:slashes);b.Append(c);slashes=0;}b.Append('\\',slashes*2);return b.Append('"').ToString();}
 static void Emit(object value){lock(Console.Out){Console.WriteLine(JsonSerializer.Serialize(value,Json));Console.Out.Flush();}}
 static void Grant(string path,SecurityIdentifier sid,bool write){
  var dir=new DirectoryInfo(path);if((dir.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Runtime/workspace root must not be a reparse point.");
  var acl=dir.GetAccessControl();var rights=write?FileSystemRights.Modify:FileSystemRights.ReadAndExecute;
  // Imported/copied project folders may carry noncanonical ACL ordering.
  // Canonicalize only this explicitly granted directory, preserving every ACE.
  if(!acl.AreAccessRulesCanonical){var descriptor=new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0);var entries=descriptor.DiscretionaryAcl!.Cast<GenericAce>().OrderBy(ace=>(ace.AceFlags&AceFlags.Inherited)!=0?2:ace.AceType.ToString().StartsWith("AccessDenied")?0:1).ToArray();var ordered=new RawAcl(descriptor.DiscretionaryAcl.Revision,entries.Length);for(int i=0;i<entries.Length;i++)ordered.InsertAce(i,entries[i]);descriptor.DiscretionaryAcl=ordered;var bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);acl.SetSecurityDescriptorBinaryForm(bytes,AccessControlSections.Access);}
  bool granted=acl.GetAccessRules(true,false,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(rule=>rule.IdentityReference.Equals(sid)&&rule.AccessControlType==AccessControlType.Allow&&(rule.FileSystemRights&rights)==rights&&(rule.InheritanceFlags&(InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit))==(InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit));
  if(!granted){acl.AddAccessRule(new FileSystemAccessRule(sid,rights,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));dir.SetAccessControl(acl);}
 }
 public static async Task<int> Main(){
  IntPtr sid=IntPtr.Zero,cap=IntPtr.Zero,attrs=IntPtr.Zero,capsPtr=IntPtr.Zero,capArray=IntPtr.Zero,handleArray=IntPtr.Zero,env=IntPtr.Zero,job=IntPtr.Zero,read=IntPtr.Zero,write=IntPtr.Zero,input=IntPtr.Zero;PROCESS_INFORMATION pi=default;Request? req=null;string started=DateTime.UtcNow.ToString("O");bool cancelled=false;string output="";
  try{
   req=JsonSerializer.Deserialize<Request>((await Console.In.ReadLineAsync())??throw new IOException("No process request"),Json)??throw new IOException("Invalid process request");
   var root=Path.GetFullPath(req.Workspace);var cwd=Path.GetFullPath(req.Cwd);if(cwd!=root&&!cwd.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Working directory escaped workspace");
   if(File.Exists(req.ReceiptPath)){Emit(new{type="result",result=JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(req.ReceiptPath))});return 0;}
   string profile="Dream.Creation."+Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(root.ToLowerInvariant())))[..24];
   int hr=CreateAppContainerProfile(profile,profile,"Dream project creation environment",IntPtr.Zero,0,out sid);if(hr<0){if(hr!=unchecked((int)0x800700B7))Marshal.ThrowExceptionForHR(hr);Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(profile,out sid));}
   var identity=new SecurityIdentifier(sid);Grant(root,identity,true);foreach(var path in req.ReadRoots)Grant(Path.GetFullPath(path),identity,false);
   Check(ConvertStringSidToSid("S-1-15-3-1",out cap)); // internetClient; no private-network capability
   capArray=Marshal.AllocHGlobal(Marshal.SizeOf<SID_AND_ATTRIBUTES>());Marshal.StructureToPtr(new SID_AND_ATTRIBUTES{Sid=cap,Attributes=4},capArray,false);
   var capabilities=new SECURITY_CAPABILITIES{AppContainerSid=sid,Capabilities=capArray,CapabilityCount=1};capsPtr=Marshal.AllocHGlobal(Marshal.SizeOf<SECURITY_CAPABILITIES>());Marshal.StructureToPtr(capabilities,capsPtr,false);
   var sa=new SECURITY_ATTRIBUTES{nLength=Marshal.SizeOf<SECURITY_ATTRIBUTES>(),bInheritHandle=true};Check(CreatePipe(out read,out write,ref sa,0));Check(SetHandleInformation(read,1,0));
   input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);if(input==new IntPtr(-1))throw new Win32Exception();
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);attrs=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attrs,2,0,ref size));
   Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20009),capsPtr,new IntPtr(Marshal.SizeOf<SECURITY_CAPABILITIES>()),IntPtr.Zero,IntPtr.Zero));
   handleArray=Marshal.AllocHGlobal(IntPtr.Size*2);Marshal.WriteIntPtr(handleArray,write);Marshal.WriteIntPtr(handleArray,IntPtr.Size,input);Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20002),handleArray,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
   var si=new STARTUPINFOEX{StartupInfo=new STARTUPINFO{cb=Marshal.SizeOf<STARTUPINFOEX>(),dwFlags=0x100,hStdInput=input,hStdOutput=write,hStdError=write},lpAttributeList=attrs};
   job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);var limits=new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();limits.BasicLimitInformation.LimitFlags=0x2000;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()));
   var environment=string.Join('\0',req.Environment.OrderBy(k=>k.Key,StringComparer.OrdinalIgnoreCase).Select(k=>$"{k.Key}={k.Value}"))+"\0\0";env=Marshal.StringToHGlobalUni(environment);
   // The bundled sh takes the command as one argument, quoted for the C runtime's argument parser; cmd.exe is the fallback.
   string cmd=req.Shell??Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.System),"cmd.exe");var command=new StringBuilder(req.Shell!=null?$"\"{cmd}\" sh -c {Quote(req.Command)}":$"\"{cmd}\" /d /s /c \"{req.Command}\"");
   Check(CreateProcess(cmd,command,IntPtr.Zero,IntPtr.Zero,true,0x00080000|0x00000400|0x08000000|0x00000004,env,cwd,ref si,out pi));
   Check(AssignProcessToJobObject(job,pi.hProcess));Check(ResumeThread(pi.hThread)!=uint.MaxValue);CloseHandle(write);write=IntPtr.Zero;CloseHandle(input);input=IntPtr.Zero;
   var jobHandle=job;var control=Task.Run(async()=>{try{await Console.In.ReadLineAsync();cancelled=true;TerminateJobObject(jobHandle,1223);}catch{}});
   using var stream=new FileStream(new SafeFileHandle(read,true),FileAccess.Read,4096,false);read=IntPtr.Zero;
   var drain=Task.Run(async()=>{using var reader=new StreamReader(stream,Encoding.UTF8);var buffer=new char[4096];int n;while((n=await reader.ReadAsync(buffer))>0){var text=new string(buffer,0,n);output=(output+text);if(output.Length>12000)output=output[^12000..];Emit(new{type="output",text});}});
   uint wait=await Task.Run(()=>WaitForSingleObject(pi.hProcess,(uint)req.TimeoutMs));if(wait==258){cancelled=true;Check(TerminateJobObject(job,1460));WaitForSingleObject(pi.hProcess,5000);}else if(wait!=0)throw new Win32Exception();
   Check(GetExitCodeProcess(pi.hProcess,out uint exit));Check(TerminateJobObject(job,exit));await drain;
   var result=new{id=req.Id,status=cancelled?"cancelled":exit==0?"complete":"failed",exitCode=(int)exit,startedAt=started,finishedAt=DateTime.UtcNow.ToString("O"),output,logPath=req.Id+".log",isolation="windows-appcontainer",commandHash=req.CommandHash};
   Directory.CreateDirectory(Path.GetDirectoryName(req.ReceiptPath)!);File.WriteAllText(req.ReceiptPath+".tmp",JsonSerializer.Serialize(result,Json));File.Move(req.ReceiptPath+".tmp",req.ReceiptPath,true);Emit(new{type="result",result});return 0;
  }catch(Exception e){Emit(new{type="error",message=e.Message,code="creation_host_failed"});return 1;}
  finally{
   if(job!=IntPtr.Zero)CloseHandle(job);if(pi.hThread!=IntPtr.Zero)CloseHandle(pi.hThread);if(pi.hProcess!=IntPtr.Zero)CloseHandle(pi.hProcess);if(read!=IntPtr.Zero)CloseHandle(read);if(write!=IntPtr.Zero)CloseHandle(write);if(input!=IntPtr.Zero&&input!=new IntPtr(-1))CloseHandle(input);
   if(attrs!=IntPtr.Zero){DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}foreach(var p in new[]{capsPtr,capArray,handleArray,env})if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);if(cap!=IntPtr.Zero)LocalFree(cap);if(sid!=IntPtr.Zero)FreeSid(sid);
  }
 }
 [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES{public IntPtr Sid;public uint Attributes;}
 [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES{public IntPtr AppContainerSid,Capabilities;public uint CapabilityCount,Reserved;}
 [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES{public int nLength;public IntPtr lpSecurityDescriptor;[MarshalAs(UnmanagedType.Bool)]public bool bInheritHandle;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO{public int cb;public string? lpReserved,lpDesktop,lpTitle;public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;public ushort wShowWindow,cbReserved2;public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;}
 [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX{public STARTUPINFO StartupInfo;public IntPtr lpAttributeList;}
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION{public IntPtr hProcess,hThread;public uint dwProcessId,dwThreadId;}
 [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS{public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION{public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,uint count,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string text,out IntPtr sid);
 [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetFileSecurity(string path,uint info,byte[] descriptor);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr ptr);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY_ATTRIBUTES attributes,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,ref SECURITY_ATTRIBUTES attributes,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string? name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exit);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
