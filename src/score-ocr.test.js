import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrebleStaffImage } from './score-ocr.js';

function syntheticStaff() {
  const width=240,height=100,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){data[i*4]=255;data[i*4+1]=255;data[i*4+2]=255;data[i*4+3]=255;}
  const pixel=(x,y)=>{const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=0};
  for(const y of [30,40,50,60,70])for(let x=10;x<230;x++)pixel(x,y);
  // Two filled oval noteheads in spaces above the bottom line.
  for(const [cx,cy] of [[60,65],[110,55]])for(let y=cy-3;y<=cy+3;y++)for(let x=cx-5;x<=cx+5;x++)if(((x-cx)/5)**2+((y-cy)/3)**2<=1)pixel(x,y);
  return {data,width,height};
}
test('score reader finds five staff lines and maps treble noteheads to pitches',()=>{
  const result=readTrebleStaffImage(syntheticStaff());
  assert.deepEqual(result.staffLines,[30,40,50,60,70]);
  assert.deepEqual(result.notes.map(n=>n.note),['F4','A4']);
  assert.match(result.warning,/Experimental/);
});
test('score reader reports a helpful error when staff lines are absent',()=>{
  const {data,width,height}=syntheticStaff();
  for(let i=0;i<width*height;i++){data[i*4]=data[i*4+1]=data[i*4+2]=255;}
  assert.throws(()=>readTrebleStaffImage({data,width,height}),/five clear staff lines/);
});
