# 安装 PDF Worker

## 下载和解压缩Chrome

下载zip包：使用wget或curl命令下载Chrome的zip包：
```bash
wget https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.264/linux64/chrome-linux64.zip
```

解压缩zip包：
```bash
unzip chrome-linux64.zip
sudo mv chrome-linux64 /opt/google-chrome
sudo ln -s /opt/google-chrome/chrome /usr/bin/google-chrome
```

## 安装依赖项

在运行无头Chrome之前，需要确保安装所有必要的依赖项。可以使用以下命令安装这些依赖项：
```bash
sudo yum install -y libX11 libXcomposite libXcursor libXdamage libXrandr libXtst cups-libs alsa-lib gtk3
```

## 运行无头Chrome检查安装

现在，您可以通过命令行启动 Chrome：
```bash
google-chrome --headless --disable-gpu --remote-debugging-port=9222 https://www.example.com
```

## 安装 chrome 驱动

解压 chrome 驱动并安装到 bin 目录：
```bash
unzip chromedriver-linux64.zip 
sudo mv chromedriver-linux64/chromedriver /usr/bin/chromedriver
```

## 安装 python 运行环境

通过包管理器安装 python 运行环境：
```bash
sudo yum install python3 python3-pip
## or
sudo dnf install python3 python3-pip
```

## 安装 Node 运行环境

通过包管理器安装 Node 运行环境：
```bash
sudo yum install nodejs npm
## or
sudo dnf install nodejs npm
```

## 安装 pdfworker

初始化 python 虚拟环境
```bash
cd pdfworker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

修改应用配置
```bash
cp .env.sample .env
```

初始化 node
```bash
npm install
```