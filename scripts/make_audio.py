# Synthesises the soundtrack (EV whine, wind, thrusters, risers, pad) from out/timeline.json
import json, sys, numpy as np, wave
from scipy.signal import butter, lfilter
SR=48000; d=json.load(open('out/timeline.json')); fps=d['fps']; rows=np.array(d['rows']); N=int(len(rows)/fps*SR)
t=np.arange(N)/SR; rng=np.random.default_rng(7)
def env(col):  # per-frame -> per-sample
    return np.interp(t, np.arange(len(rows))/fps, rows[:,col])
v=env(0); down=env(2); rear=env(3)
def lp(x,f): b,a=butter(2,f/(SR/2)); return lfilter(b,a,x)
def bp(x,lo,hi): b,a=butter(2,[lo/(SR/2),hi/(SR/2)],btype='band'); return lfilter(b,a,x)
noise=rng.standard_normal(N)
out=np.zeros(N)
# pad: slow chords
for i,f in enumerate([55,82.4,110,164.8]):
    out+=0.05*np.sin(2*np.pi*f*t+i)*(0.6+0.4*np.sin(2*np.pi*0.05*t+i))
# EV whine follows speed
ph=np.cumsum(300+v*14)/SR*2*np.pi
out+=np.clip(v/40,0,1)*(0.05*np.sin(ph)+0.025*np.sin(2*ph)+0.012*np.sin(3*ph))
# wind
out+=lp(noise,900)*np.clip((v/100)**2,0,1)*0.35
# thrusters: roar
out+=bp(noise,80,1800)*np.clip(down,0,1)*0.45+bp(noise,120,3000)*np.clip(rear,0,1)*0.4
# launch thump + riser into 135 s, countdown beeps, impacts at chapter starts
def hit(at,amp=0.7,f0=70,dur=1.6):
    i=int(at*SR); n=min(int(dur*SR),N-i); 
    if n<=0: return
    tt=np.arange(n)/SR; out[i:i+n]+=amp*np.sin(2*np.pi*(f0*np.exp(-tt*3))*tt*4)*np.exp(-tt*3)
def riser(a,b,amp=0.25):
    i,j=int(a*SR),int(b*SR); n=j-i; x=bp(noise[i:j],200,6000)*np.linspace(0,1,n)**2; out[i:j]+=amp*x
def beep(at,f=880,dur=0.18):
    i=int(at*SR); tt=np.arange(int(dur*SR))/SR; out[i:i+len(tt)]+=0.25*np.sin(2*np.pi*f*tt)*np.exp(-tt*8)
for c in (12,15,18): beep(c)
beep(21,1320,0.5)
riser(21,27); hit(27,0.9); hit(30,0.5); hit(120,0.5); riser(130,135); hit(135,1.0)
for c in (180,240,285,330,360,420,438): hit(c,0.55)
riser(250,258,0.3); riser(300,304,0.2); hit(348,0.8,50)
fade=np.minimum(1,np.minimum(t/2,(N/SR-t)/3)); out*=fade
out=np.tanh(out*1.6)*0.8
st=np.stack([out,np.roll(out,40)],1)
pcm=(st*32767).astype(np.int16)
with wave.open('out/audio.wav','wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('audio ok',N/SR,'s')
