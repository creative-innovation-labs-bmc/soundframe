export function exportConfig(input={},format='square',seconds=0){
 const resolution=[540,720,1080].includes(+input.resolution)?+input.resolution:1080;
 const quality=['small','balanced','high'].includes(input.quality)?input.quality:'balanced';
 const audio=[128000,192000,256000,320000].includes(+input.audio)?+input.audio:192000;
 const width=format==='landscape'?Math.round(resolution*16/9/2)*2:resolution;
 const height=format==='portrait'?Math.round(resolution*16/9/2)*2:resolution;
 const video=Math.round(({small:2500000,balanced:5000000,high:10000000}[quality])*width*height/(1080*1080));
 return {resolution,quality,audio,width,height,video,estimatedMB:(video+audio)*Math.max(0,seconds)/8/1048576};
}
export function chooseExportType(container,supported){
 const mp4=['video/mp4;codecs=avc1.420028,mp4a.40.2','video/mp4;codecs=avc1.42E01E,mp4a.40.2'];
 const webm=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'];
 return (container==='webm'?webm:container==='mp4'?mp4:[...mp4,...webm]).find(supported)||null;
}
