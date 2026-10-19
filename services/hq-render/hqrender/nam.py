# Minimal loader/inference for NAM WaveNet captures in the v0.5 file format (as in NeuralAmpModeler v0.5):
# per layer array: rechannel(1x1, no bias), layers [dilated conv(+bias), input mixin(1x1, no bias), 1x1(+bias)],
# head rechannel(1x1, bias if head_bias); final head_scale. Causal ("valid") convs with left zero padding.
import json, numpy as np, torch, torch.nn.functional as F

class NamWaveNet(torch.nn.Module):
    def __init__(self, cfg, weights):
        super().__init__()
        w = torch.tensor(weights, dtype=torch.float32); self.pos = 0
        def take(*shape):
            n = int(np.prod(shape)); t = w[self.pos:self.pos + n].reshape(shape); self.pos += n; return t
        self.arrays = []
        for la in cfg['layers']:
            if la.get('gated'): raise ValueError('gated arrays not supported')
            C, k = la['channels'], la['kernel_size']
            arr = {'cfg': la, 'rechannel': take(C, la['input_size'], 1), 'layers': []}
            for d in la['dilations']:
                arr['layers'].append({'d': d, 'conv_w': take(C, C, k), 'conv_b': take(C), 'mix_w': take(C, la['condition_size'], 1),
                                      'w1': take(C, C, 1), 'b1': take(C)})
            arr['head_w'] = take(la['head_size'], C, 1); arr['head_b'] = take(la['head_size']) if la['head_bias'] else None
            self.arrays.append(arr)
        self.head_scale = float(w[self.pos]) if cfg.get('head_scale') is None else float(cfg['head_scale'])
        n_used = self.pos + (1 if self.pos < len(w) else 0)
        if n_used != len(w): raise ValueError(f'weight count mismatch: used {n_used} of {len(w)}')
        if cfg.get('head') is not None: raise ValueError('separate head not supported')
        self.rf = sum((la['kernel_size'] - 1) * sum(la['dilations']) for la in cfg['layers'])
        act = cfg['layers'][0]['activation']; self.act = {'Tanh': torch.tanh, 'ReLU': F.relu}[act]

    def forward(self, x):  # x: (B, T) -> (B, T)
        T = x.shape[-1]; c = F.pad(x, (self.rf, 0)).unsqueeze(1); y = c; head = None
        for arr in self.arrays:
            h = F.conv1d(y, arr['rechannel'])
            for L in arr['layers']:
                z = F.conv1d(h, L['conv_w'], L['conv_b'], dilation=L['d'])
                z = z + F.conv1d(c, L['mix_w'])[..., -z.shape[-1]:]
                z = self.act(z)
                h = h[..., -z.shape[-1]:] + F.conv1d(z, L['w1'], L['b1'])
                head = z if head is None else head[..., -z.shape[-1]:] + z
            head = F.conv1d(head, arr['head_w'], arr['head_b']); y = h
        return (self.head_scale * head)[:, 0, -T:]

def load(path):
    j = json.load(open(path))
    if j.get('architecture') != 'WaveNet': raise ValueError('not a WaveNet capture')
    return NamWaveNet(j['config'], j['weights']).eval()

def to(model, device):
    """Move a loaded capture's weights to a torch device (e.g. 'mps')."""
    for arr in model.arrays:
        for k in ('rechannel', 'head_w', 'head_b'):
            if arr[k] is not None: arr[k] = arr[k].to(device)
        for L in arr['layers']:
            for k in ('conv_w', 'conv_b', 'mix_w', 'w1', 'b1'): L[k] = L[k].to(device)
    return model
