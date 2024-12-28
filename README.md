# pdfworker

## Prepare

install

```bash
sudo apt update
sudo apt install -y curl unzip xvfb libxi6 libgconf-2-4 libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgtk-3-0 python3.11 python3.11-dev python3-pip
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb sudo apt install ./google-chrome-stable_current_amd64.deb
wget https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.204/linux64/chromedriver-linux64.zip
unzip chromedriver-linux64.zip 
sudo mv chromedriver-linux64/chromedriver /usr/bin/chromedriver
sudo apt install nodejs npm
```

validate runtime

```bash
google-chrome --version
chromedriver -v
node -v
npm -v
python3.11 --version
```

clean

```bash
rm -f google-chrome-stable_current_amd64.deb
rm -rf chromedriver-linux64
rm -f chromedriver-linux64.zip
```

## How to run it

```bash
conda create -n pdfworker python=3.11
conda activate pdfworker
pip install -r requirements.txt
cp .env.sample .env
```
change them use yourself information.

```bash
npm start
```

## Docker Setup

### How to build

```bash
docker build -t pdfworker .

```

## How to run

```bash
docker run -d \
    -p 5000:5000 \
    -e CBM_BASE_URL=http://host.docker.internal:8080/cb \
    -e CBM_API_KEY=Ym9uZDowMDc= \
    -e SECRET=attentionisallyouneed! \
    pdfworker
```